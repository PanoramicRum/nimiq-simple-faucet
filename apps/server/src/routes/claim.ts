import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, isNull, isNotNull, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { DriverError, canonicalizeHostContext, type ClaimRequest } from '@faucet/core';
import { mintChallenge } from '@faucet/abuse-hashcash';
import { claims, integratorKeys } from '../db/schema.js';
import type { AppContext } from '../context.js';
import { incrementIpCounter, decrementIpCounter } from '../abuse/rateLimit.js';
import { verifyIntegratorRequest, type IntegratorKey } from '../hmac.js';
import { claimsTotal, claimDuration } from '../metrics.js';
import { ClaimRequest as ClaimRequestSchema } from '../openapi/schemas.js';
import { derivePublicConfig } from '../configView.js';

// Extend the shared OpenAPI schema with the backwards-compat transform.
const ClaimBody = ClaimRequestSchema.transform(({ powSolution, hashcashSolution, ...rest }) => ({
  ...rest,
  hashcashSolution: hashcashSolution ?? powSolution,
}));

export async function claimRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/config', async () => derivePublicConfig(ctx.config));

  app.post('/v1/challenge', {
    bodyLimit: 1024,
    config: {
      rateLimit: { max: ctx.config.challengeRatePerMinute, timeWindow: '1 minute' },
    },
  }, async (req, reply) => {
    if (!ctx.config.hashcashSecret) {
      return reply.code(404).send({ error: 'hashcash not enabled' });
    }
    const uid = typeof (req.body as { uid?: unknown } | null)?.uid === 'string'
      ? (req.body as { uid: string }).uid.slice(0, 128)
      : undefined;
    const challenge = mintChallenge(
      {
        secret: ctx.config.hashcashSecret,
        difficulty: ctx.config.hashcashDifficulty,
        ttlMs: ctx.config.hashcashTtlMs,
      },
      uid ? { ip: req.ip, uid } : { ip: req.ip },
    );
    return reply.send(challenge);
  });

  const inflightClaims = new Set<string>();

  app.post('/v1/claim', { bodyLimit: 16 * 1024 }, async (req, reply) => {
    const now = Date.now();
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    const parsed = ClaimBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
    }

    // Idempotency: if the same key was used before, return the original result.
    if (parsed.data.idempotencyKey) {
      const [existing] = await ctx.db
        .select()
        .from(claims)
        .where(eq(claims.idempotencyKey, parsed.data.idempotencyKey))
        .limit(1);
      if (existing) {
        return reply.code(200).send({
          id: existing.id,
          status: existing.status,
          txId: existing.txId ?? undefined,
          idempotent: true,
        });
      }
    }

    let integratorId: string | undefined;
    let hostContextVerified = false;
    const apiKey = req.headers['x-faucet-api-key'];
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      const result = await verifyIntegratorRequest({
        db: ctx.db,
        keys: ctx.config.integratorKeys,
        method: req.method,
        path: req.url,
        body: rawBody,
        headers: {
          apiKey,
          timestamp: req.headers['x-faucet-timestamp'] as string | undefined,
          nonce: req.headers['x-faucet-nonce'] as string | undefined,
          signature: req.headers['x-faucet-signature'] as string | undefined,
        },
        now,
        async lookupByKey(key: string): Promise<IntegratorKey | null> {
          const hash = createHash('sha256').update(key).digest('hex');
          const [row] = await ctx.db
            .select()
            .from(integratorKeys)
            .where(and(eq(integratorKeys.apiKeyHash, hash), isNull(integratorKeys.revokedAt)))
            .limit(1);
          if (!row) return null;
          await ctx.db
            .update(integratorKeys)
            .set({ lastUsedAt: new Date() })
            .where(eq(integratorKeys.id, row.id));
          return { id: row.id, key, secret: row.hmacSecret };
        },
      });
      if (!result.ok) {
        return reply.code(401).send({ error: `integrator auth failed: ${result.reason}` });
      }
      integratorId = result.integratorId;
      hostContextVerified = true;
    }

    // Per-field host-context signature verification (§1.4).
    // Allows browser SDKs to submit a pre-signed hostContext without the
    // integrator's backend proxying the whole request. Format:
    //   hostContext.signature = "{integratorId}:{base64-hmac}"
    if (!hostContextVerified && parsed.data.hostContext?.signature) {
      const sig = parsed.data.hostContext.signature;
      const colonIdx = sig.indexOf(':');
      if (colonIdx > 0) {
        const sigIntegratorId = sig.slice(0, colonIdx);
        const sigHmac = sig.slice(colonIdx + 1);
        const [row] = await ctx.db
          .select()
          .from(integratorKeys)
          .where(and(eq(integratorKeys.id, sigIntegratorId), isNull(integratorKeys.revokedAt)))
          .limit(1);
        if (row) {
          const canonical = canonicalizeHostContext(parsed.data.hostContext);
          const expected = createHmac('sha256', row.hmacSecret).update(canonical).digest('base64');
          try {
            if (timingSafeEqual(Buffer.from(sigHmac, 'base64'), Buffer.from(expected, 'base64'))) {
              hostContextVerified = true;
              integratorId = sigIntegratorId;
            }
          } catch {
            // Length mismatch → not equal, leave hostContextVerified false.
          }
        }
      }
    }

    let address: string;
    try {
      address = ctx.driver.parseAddress(parsed.data.address);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: 'invalid address', message: (err as Error).message });
    }

    // Increment the IP counter BEFORE the abuse pipeline to close the TOCTOU
    // window (#52). Concurrent requests from the same IP now see the incremented
    // counter immediately. Rejected/challenged claims decrement below.
    await incrementIpCounter(ctx.db, req.ip, now);

    const claimReq: ClaimRequest = {
      address,
      ip: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      captchaToken: parsed.data.captchaToken,
      hashcashSolution: parsed.data.hashcashSolution,
      fingerprint: parsed.data.fingerprint,
      hostContext: parsed.data.hostContext,
      hostContextVerified,
      integratorId,
      requestedAt: now,
    };

    const evaluation = await ctx.pipeline.evaluate(claimReq);
    const id = nanoid();

    if (evaluation.decision === 'deny' || evaluation.decision === 'review') {
      await decrementIpCounter(ctx.db, req.ip, now);
      await ctx.db.insert(claims).values({
        id,
        address,
        amountLuna: ctx.config.claimAmountLuna.toString(),
        status: 'rejected',
        ip: req.ip,
        userAgent: claimReq.userAgent ?? null,
        integratorId: integratorId ?? null,
        abuseScore: Math.round(evaluation.score * 1000),
        decision: evaluation.decision,
        signalsJson: JSON.stringify(evaluation.signals),
        rejectionReason: evaluation.reasons.join('; ') || evaluation.decision,
        idempotencyKey: parsed.data.idempotencyKey ?? null,
      });
      claimsTotal.inc({ status: 'rejected', decision: evaluation.decision });
      claimDuration.observe({ phase: 'total' }, (Date.now() - now) / 1000);
      return reply.code(evaluation.decision === 'deny' ? 403 : 202).send({
        id,
        status: 'rejected',
        decision: evaluation.decision,
        reason: evaluation.reasons[0] ?? evaluation.decision,
      });
    }

    if (evaluation.decision === 'challenge') {
      await decrementIpCounter(ctx.db, req.ip, now);
      await ctx.db.insert(claims).values({
        id,
        address,
        amountLuna: ctx.config.claimAmountLuna.toString(),
        status: 'challenged',
        ip: req.ip,
        userAgent: claimReq.userAgent ?? null,
        integratorId: integratorId ?? null,
        abuseScore: Math.round(evaluation.score * 1000),
        decision: evaluation.decision,
        signalsJson: JSON.stringify(evaluation.signals),
        idempotencyKey: parsed.data.idempotencyKey ?? null,
      });
      claimsTotal.inc({ status: 'challenged', decision: 'challenge' });
      claimDuration.observe({ phase: 'total' }, (Date.now() - now) / 1000);
      return reply.code(202).send({
        id,
        status: 'challenged',
        decision: 'challenge',
        reason: 'complete additional challenge and retry',
      });
    }

    // allow — lock per address to prevent duplicate txIds from concurrent
    // requests (the Nimiq node deduplicates identical mempool transactions,
    // so two sends with the same params return the same hash). See #50.
    if (inflightClaims.has(address)) {
      return reply.code(429).send({
        error: 'claim_in_progress',
        message: 'A claim for this address is already being processed. Try again shortly.',
      });
    }
    inflightClaims.add(address);
    let txId: string;
    try {
      txId = await ctx.driver.send(address, ctx.config.claimAmountLuna);
    } catch (err) {
      inflightClaims.delete(address);
      await decrementIpCounter(ctx.db, req.ip, now);
      if (err instanceof DriverError && err.code === 'RPC_-32602') {
        return reply.code(400).send({
          error: 'invalid address',
          message: 'Address rejected by the network (invalid checksum or format)',
        });
      }
      // Record the failed send so it's visible in the activity log.
      const errMsg = err instanceof Error ? err.message : String(err);
      await ctx.db.insert(claims).values({
        id,
        address,
        amountLuna: ctx.config.claimAmountLuna.toString(),
        status: 'rejected',
        ip: req.ip,
        userAgent: claimReq.userAgent ?? null,
        integratorId: integratorId ?? null,
        abuseScore: Math.round(evaluation.score * 1000),
        decision: 'allow',
        signalsJson: JSON.stringify(evaluation.signals),
        rejectionReason: `system error: ${errMsg}`.slice(0, 256),
        idempotencyKey: parsed.data.idempotencyKey ?? null,
      });
      claimsTotal.inc({ status: 'rejected', decision: 'allow' });
      claimDuration.observe({ phase: 'total' }, (Date.now() - now) / 1000);
      return reply.code(503).send({
        id,
        status: 'rejected',
        error: 'send_failed',
        message: 'Transaction could not be sent. Please try again shortly.',
      });
    }
    await ctx.db.insert(claims).values({
      id,
      address,
      amountLuna: ctx.config.claimAmountLuna.toString(),
      status: 'broadcast',
      txId,
      ip: req.ip,
      userAgent: claimReq.userAgent ?? null,
      integratorId: integratorId ?? null,
      abuseScore: Math.round(evaluation.score * 1000),
      decision: 'allow',
      signalsJson: JSON.stringify(evaluation.signals),
      idempotencyKey: parsed.data.idempotencyKey ?? null,
    });
    inflightClaims.delete(address);
    // IP counter was already incremented before the pipeline (see #52 fix above).
    claimsTotal.inc({ status: 'broadcast', decision: 'allow' });
    claimDuration.observe({ phase: 'total' }, (Date.now() - now) / 1000);
    ctx.stream.publish({ type: 'claim.broadcast', id, address, txId });

    // Confirm asynchronously; don't block the response.
    ctx.driver
      .waitForConfirmation(txId)
      .then(async () => {
        await ctx.db.update(claims).set({ status: 'confirmed' }).where(eq(claims.id, id));
        ctx.stream.publish({ type: 'claim.confirmed', id, address, txId });
      })
      .catch(async (err: unknown) => {
        if (err instanceof DriverError && err.code === 'CONFIRM_TIMEOUT') {
          await ctx.db.update(claims).set({ status: 'timeout' }).where(eq(claims.id, id));
        }
        req.log.warn({ err, txId, id }, 'confirmation failed');
      });

    return reply.code(200).send({ id, status: 'broadcast', txId });
  });

  app.get('/v1/claim/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(claims).where(eq(claims.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'not found' });
    return {
      id: row.id,
      status: row.status,
      address: row.address,
      amountLuna: row.amountLuna,
      txId: row.txId,
      createdAt: row.createdAt,
      decision: row.decision,
      rejectionReason: row.rejectionReason,
    };
  });

  app.get('/v1/stats', async () => {
    const recent = await ctx.db
      .select({
        id: claims.id,
        createdAt: claims.createdAt,
        status: claims.status,
        decision: claims.decision,
      })
      .from(claims)
      .limit(100);
    return {
      total: recent.length,
      byStatus: groupBy(recent.map((r) => r.status)),
      byDecision: groupBy(recent.map((r) => r.decision)),
    };
  });

  // ── /v1/stats/summary — time-windowed aggregates (public, cached 30s) ──

  let summaryCache: { data: unknown; ts: number } | null = null;

  app.get('/v1/stats/summary', async () => {
    const now = Date.now();
    if (summaryCache && now - summaryCache.ts < 30_000) return summaryCache.data;

    const windows = {
      '1h': new Date(now - 60 * 60_000),
      '24h': new Date(now - 24 * 60 * 60_000),
      '7d': new Date(now - 7 * 24 * 60 * 60_000),
    };

    // Successful claims: count distinct txIds for claims that were actually sent
    // (decision=allow AND txId is not null). Excludes system errors and duplicates.
    const claimSelect = { txId: claims.txId };
    const sentFilter = and(eq(claims.decision, 'allow'), isNotNull(claims.txId));
    const [allowed1hRaw, allowed24hRaw, allowed7dRaw] = await Promise.all([
      ctx.db.select(claimSelect).from(claims).where(and(gte(claims.createdAt, windows['1h']), sentFilter)),
      ctx.db.select(claimSelect).from(claims).where(and(gte(claims.createdAt, windows['24h']), sentFilter)),
      ctx.db.select(claimSelect).from(claims).where(and(gte(claims.createdAt, windows['7d']), sentFilter)),
    ]);

    const countUniqueTx = (rows: { txId: string | null }[]): number => dedupeByTxId(rows).length;

    // Blocked claims: denied claims don't have duplicate rows, so COUNT(*) is fine.
    const [blocked1h, blocked24h, blocked7d] = await Promise.all([
      ctx.db.select({ n: sql<number>`count(*)` }).from(claims).where(and(gte(claims.createdAt, windows['1h']), eq(claims.decision, 'deny'))),
      ctx.db.select({ n: sql<number>`count(*)` }).from(claims).where(and(gte(claims.createdAt, windows['24h']), eq(claims.decision, 'deny'))),
      ctx.db.select({ n: sql<number>`count(*)` }).from(claims).where(and(gte(claims.createdAt, windows['7d']), eq(claims.decision, 'deny'))),
    ]);

    const successCount24h = countUniqueTx(allowed24hRaw);
    const blockedCount24h = blocked24h[0]?.n ?? 0;
    const total24h = successCount24h + blockedCount24h;

    const topReasons = await ctx.db
      .select({ reason: claims.rejectionReason, n: sql<number>`count(*)` })
      .from(claims)
      .where(and(gte(claims.createdAt, windows['24h']), isNotNull(claims.rejectionReason)))
      .groupBy(claims.rejectionReason)
      .orderBy(sql`count(*) desc`)
      .limit(5);

    const claimFields = {
      id: claims.id,
      createdAt: claims.createdAt,
      address: claims.address,
      amountLuna: claims.amountLuna,
      status: claims.status,
      decision: claims.decision,
      txId: claims.txId,
      rejectionReason: claims.rejectionReason,
    };

    const [recentClaimsRaw, recentBlockedRaw] = await Promise.all([
      // Successful claims: decision=allow AND actually sent (has txId)
      ctx.db.select(claimFields).from(claims)
        .where(and(eq(claims.decision, 'allow'), isNotNull(claims.txId)))
        .orderBy(desc(claims.createdAt)).limit(50),
      // Blocked/failed: denied by pipeline OR system errors (rejected despite allow decision)
      ctx.db.select(claimFields).from(claims)
        .where(or(eq(claims.decision, 'deny'), and(eq(claims.status, 'rejected'), eq(claims.decision, 'allow'))))
        .orderBy(desc(claims.createdAt)).limit(10),
    ]);

    // Deduplicate by txId — concurrent requests can create multiple rows for
    // the same on-chain transaction.
    const recentClaims = dedupeByTxId(recentClaimsRaw).slice(0, 20);
    const recentBlocked = recentBlockedRaw;

    let balance: string;
    try {
      balance = (await ctx.driver.getBalance()).toString();
    } catch {
      balance = '0';
    }

    const data = {
      balance,
      claims: { '1h': countUniqueTx(allowed1hRaw), '24h': successCount24h, '7d': countUniqueTx(allowed7dRaw) },
      blocked: { '1h': blocked1h[0]?.n ?? 0, '24h': blockedCount24h, '7d': blocked7d[0]?.n ?? 0 },
      successRate: total24h > 0 ? successCount24h / total24h : 0,
      recentClaims,
      recentBlocked,
      topRejectionReasons: topReasons.map((r) => ({ reason: r.reason ?? 'unknown', count: r.n })),
    };
    summaryCache = { data, ts: now };
    return data;
  });

  // ── /v1/claims/recent — public paginated claims (no sensitive fields) ──

  app.get('/v1/claims/recent', async (req) => {
    const query = req.query as { limit?: string; offset?: string; status?: string };
    const limit = Math.min(Math.max(parseInt(query.limit ?? '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(query.offset ?? '0', 10) || 0, 0);
    const statusFilter = query.status;

    const conds = statusFilter ? eq(claims.status, statusFilter) : undefined;

    const rowsRaw = await ctx.db
      .select({
        id: claims.id,
        createdAt: claims.createdAt,
        address: claims.address,
        amountLuna: claims.amountLuna,
        status: claims.status,
        decision: claims.decision,
        txId: claims.txId,
        rejectionReason: claims.rejectionReason,
      })
      .from(claims)
      .where(conds)
      .orderBy(desc(claims.createdAt))
      .limit(limit * 3) // fetch extra to account for dedup
      .offset(offset);

    const rows = dedupeByTxId(rowsRaw).slice(0, limit);

    const countResult = await ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(claims)
      .where(conds);

    return { total: countResult[0]?.n ?? 0, items: rows };
  });

  // ── /v1/events — recent system events (from in-memory ring buffer) ──

  app.get('/v1/events', async () => {
    return { events: ctx.events.list(20) };
  });
}

function groupBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

/** Deduplicate rows that share the same txId (concurrent requests for the same on-chain tx). */
function dedupeByTxId<T extends { txId: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (r.txId && seen.has(r.txId)) return false;
    if (r.txId) seen.add(r.txId);
    return true;
  });
}
