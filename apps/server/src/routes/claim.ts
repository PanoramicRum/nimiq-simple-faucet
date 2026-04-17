import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { DriverError, type ClaimRequest } from '@faucet/core';
import { mintChallenge } from '@faucet/abuse-hashcash';
import { claims, integratorKeys } from '../db/schema.js';
import type { AppContext } from '../context.js';
import { incrementIpCounter, decrementIpCounter } from '../abuse/rateLimit.js';
import { verifyIntegratorRequest, type IntegratorKey } from '../hmac.js';
import { claimsTotal, claimDuration } from '../metrics.js';
import { ClaimRequest as ClaimRequestSchema } from '../openapi/schemas.js';

// Extend the shared OpenAPI schema with the backwards-compat transform.
const ClaimBody = ClaimRequestSchema.transform(({ powSolution, hashcashSolution, ...rest }) => ({
  ...rest,
  hashcashSolution: hashcashSolution ?? powSolution,
}));

export async function claimRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/config', async () => ({
    network: ctx.config.network,
    claimAmountLuna: ctx.config.claimAmountLuna.toString(),
    abuseLayers: {
      turnstile: !!ctx.config.turnstileSiteKey,
      hcaptcha: !!ctx.config.hcaptchaSiteKey,
      hashcash: !!ctx.config.hashcashSecret,
      geoip: ctx.config.geoipBackend !== 'none',
      fingerprint: ctx.config.fingerprintEnabled,
      onchain: ctx.config.onchainEnabled,
      ai: ctx.config.aiEnabled,
    },
    captcha: ctx.config.turnstileSiteKey
      ? { provider: 'turnstile', siteKey: ctx.config.turnstileSiteKey }
      : ctx.config.hcaptchaSiteKey
        ? { provider: 'hcaptcha', siteKey: ctx.config.hcaptchaSiteKey }
        : null,
    hashcash: ctx.config.hashcashSecret
      ? { difficulty: ctx.config.hashcashDifficulty, ttlMs: ctx.config.hashcashTtlMs }
      : null,
    geoipAttribution: ctx.config.geoipBackend === 'dbip'
      ? 'IP geolocation by DB-IP (https://db-ip.com)'
      : undefined,
  }));

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
      throw err;
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
}

function groupBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}
