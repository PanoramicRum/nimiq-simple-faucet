import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, isNull, isNotNull, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  DriverError,
  canonicalizeHostContext,
  stripUnsignedHostContext,
  type ClaimRequest,
} from '@faucet/core';
import { mintChallenge } from '@faucet/abuse-hashcash';
import { claims, integratorKeys } from '../db/schema.js';
import type { AppContext } from '../context.js';
import { incrementIpCounter, decrementIpCounter } from '../abuse/rateLimit.js';
import { verifyIntegratorRequest, type IntegratorKey } from '../hmac.js';
import { claimsTotal, claimDuration, rewardAdjustmentsTotal } from '../metrics.js';
import { ClaimRequest as ClaimRequestSchema } from '../openapi/schemas.js';
import { derivePublicConfig } from '../configView.js';
import {
  calculateAutomaticReward,
  resolvePayout,
  resolveRewardSettings,
} from '../rewards/automatic.js';
import { isFirstTimeClaimant } from '../rewards/firstTime.js';
import { findWhitelistMatch, type WhitelistMatch } from '../rewards/whitelist.js';
import {
  countRepeatClaims,
  effectiveRepeatReductionPercent,
  isRepeatTierConfigured,
} from '../rewards/repeatUser.js';
import { readRuntimeOverrides } from '../runtimeConfig.js';

// Extend the shared OpenAPI schema with the backwards-compat transform.
const ClaimBody = ClaimRequestSchema.transform(({ powSolution, hashcashSolution, ...rest }) => ({
  ...rest,
  hashcashSolution: hashcashSolution ?? powSolution,
}));

/**
 * Pad a reject response so its wall-clock latency is at least `targetMs`
 * relative to the request start. Defends against pipeline-position timing
 * attribution (audits/findings-2026-05/024) — the pipeline short-circuits
 * on the first hard deny, so without padding a rate-limit reject lands in
 * ~5ms and an AI reject in ~2s, which leaks layer position even when the
 * response body is uniform. Use the same floor for every public reject
 * path so the existence of padding itself isn't a side-channel.
 */
async function padRejectDelay(startedAt: number, targetMs: number): Promise<void> {
  if (targetMs <= 0) return;
  const elapsed = Date.now() - startedAt;
  if (elapsed >= targetMs) return;
  await new Promise((r) => setTimeout(r, targetMs - elapsed));
}

export async function claimRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/config', async () => derivePublicConfig(ctx.config));

  app.post('/v1/challenge', {
    bodyLimit: 1024,
    config: {
      rateLimit: { max: ctx.config.challengeRatePerMinute, timeWindow: '1 minute' },
    },
  }, async (req, reply) => {
    if (!ctx.config.hashcashSecret) {
      return reply.code(404).send({ error: 'hashcash not enabled', code: 'HASHCASH_DISABLED' });
    }
    // Browser-only enforcement for challenge minting too.
    if (ctx.config.requireBrowser) {
      const apiKey = req.headers['x-faucet-api-key'];
      const hasIntegratorAuth = typeof apiKey === 'string' && apiKey.length > 0;
      if (!hasIntegratorAuth && !req.headers['sec-fetch-site']) {
        return reply.code(403).send({
          error: 'browser_required',
          code: 'BROWSER_REQUIRED',
          message: 'Challenges must be requested from a browser.',
        });
      }
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

  app.post('/v1/claim', {
    bodyLimit: 16 * 1024,
    preHandler: app.rateLimit({ max: ctx.config.rateLimitPerMinute, timeWindow: '1 minute' }),
  }, async (req, reply) => {
    // Capture wall-clock start before any branch so every reject path
    // can pad to the same minimum latency (audits/findings-2026-05/024).
    // The browser/origin gates below are intentionally NOT padded — they
    // have distinguishable bodies and fast-fail semantics for legitimate
    // non-browser callers (Mini App SDKs, integrator backends).
    const requestStart = Date.now();
    const T_min = ctx.config.rejectDelayMsMin;
    // Browser-only enforcement: when enabled, reject requests that don't
    // originate from a real browser. Integrators bypass this via HMAC auth.
    if (ctx.config.requireBrowser) {
      const apiKey = req.headers['x-faucet-api-key'];
      const hasIntegratorAuth = typeof apiKey === 'string' && apiKey.length > 0;
      if (!hasIntegratorAuth) {
        // Sec-Fetch-Site is sent by all modern browsers (Chrome 76+, Firefox 90+,
        // Safari 16.4+). Scripts (curl, Python requests, etc.) don't send it.
        const secFetchSite = req.headers['sec-fetch-site'];
        if (!secFetchSite) {
          return reply.code(403).send({
            error: 'browser_required',
            code: 'BROWSER_REQUIRED',
            message: 'Claims must be submitted from a browser. Use the ClaimUI or an authorized integrator SDK.',
          });
        }
        // Also enforce Origin against the CORS allowlist. Issue #122:
        // entries can be strings OR RegExps (`*.example.com` becomes a
        // RegExp at config-parse time), so we match against both forms
        // instead of `Array.includes` which would skip the regexes.
        const origin = req.headers['origin'];
        const allowedOrigins = ctx.config.corsOrigins;
        if (
          origin &&
          typeof origin === 'string' &&
          Array.isArray(allowedOrigins) &&
          !allowedOrigins.some((o) =>
            typeof o === 'string' ? o === origin : o.test(origin),
          )
        ) {
          return reply.code(403).send({
            error: 'origin_not_allowed',
            code: 'ORIGIN_NOT_ALLOWED',
            message: 'Request origin is not in the allowed list.',
          });
        }
      }
    }

    const now = Date.now();
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    const parsed = ClaimBody.safeParse(req.body);
    if (!parsed.success) {
      await padRejectDelay(requestStart, T_min);
      return reply.code(400).send({ error: 'invalid request', code: 'INVALID_REQUEST' });
    }

    // Resolve the payout amount once. Automatic mode OFF (default) → the fixed
    // operator-configured `claimAmountLuna` (today's behaviour, unchanged).
    // Automatic mode ON → the configured baseline; any amount a developer app
    // sends is already ignored (the request schema has no `amount` field).
    // Every amount the handler records or sends flows through this single seam,
    // so deny/challenge/error rows stay consistent with what would have paid.
    const payout = resolvePayout(ctx.config);

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
        await padRejectDelay(requestStart, T_min);
        return reply.code(401).send({ error: 'integrator auth failed', code: 'INTEGRATOR_AUTH_FAILED' });
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
    } catch {
      await padRejectDelay(requestStart, T_min);
      return reply.code(400).send({ error: 'invalid address', code: 'INVALID_ADDRESS' });
    }

    // Idempotency lookup (#86). Scoped by:
    //   - (integratorId, idempotencyKey) for authenticated callers — each
    //     integrator's namespace is isolated; a colliding key from another
    //     integrator never reads this one's claim.
    //   - (idempotencyKey, address) for unauthenticated callers — the
    //     "same logical request" can only be inferred from address + key.
    // This sits AFTER auth + address parsing so we know the scope; before
    // any IP counter / pipeline work, so a legitimate retry costs nothing.
    if (parsed.data.idempotencyKey) {
      const conds =
        integratorId !== undefined
          ? and(
              eq(claims.idempotencyKey, parsed.data.idempotencyKey),
              eq(claims.integratorId, integratorId),
            )
          : and(
              eq(claims.idempotencyKey, parsed.data.idempotencyKey),
              isNull(claims.integratorId),
              eq(claims.address, address),
            );
      const [existing] = await ctx.db.select().from(claims).where(conds).limit(1);
      if (existing) {
        return reply.code(200).send({
          id: existing.id,
          status: existing.status,
          txId: existing.txId ?? undefined,
          idempotent: true,
        });
      }
    }

    // Increment the IP counter BEFORE the abuse pipeline to close the TOCTOU
    // window (#52). Concurrent requests from the same IP now see the incremented
    // counter immediately. Rejected/challenged claims decrement below.
    await incrementIpCounter(ctx.db, req.ip, now);

    // #96 trust-boundary: when hostContext is present but unverified
    // (no/bad integrator HMAC), strip every claim-bearing field before
    // the abuse pipeline sees it. A forged `kycLevel: 'id'` /
    // `verifiedIdentities: [...]` / etc. must not nudge scoring in the
    // attacker's favour. The empty-object form preserves the
    // "context attempted, failed verification" signal that fingerprint
    // already penalises softly.
    const safeHostContext =
      parsed.data.hostContext !== undefined
        ? hostContextVerified
          ? parsed.data.hostContext
          : stripUnsignedHostContext(parsed.data.hostContext)
        : undefined;

    const claimReq: ClaimRequest = {
      address,
      ip: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      captchaToken: parsed.data.captchaToken,
      hashcashSolution: parsed.data.hashcashSolution,
      fingerprint: parsed.data.fingerprint,
      hostContext: safeHostContext,
      hostContextVerified,
      integratorId,
      requestedAt: now,
    };

    // Identity signals recorded on every claim row for first-time-boost
    // detection. `hostUid` is recorded ONLY when the host context was
    // HMAC-verified — a forgeable/unverified uid must never enter the table
    // (it would let an attacker poison detection or grief a victim's boost).
    const fingerprintVisitorId = parsed.data.fingerprint?.visitorId ?? null;
    const hostUid = hostContextVerified ? (parsed.data.hostContext?.uid ?? null) : null;

    const evaluation = await ctx.pipeline.evaluate(claimReq);
    const id = nanoid();

    if (evaluation.decision === 'deny' || evaluation.decision === 'review') {
      await decrementIpCounter(ctx.db, req.ip, now);
      await ctx.db.insert(claims).values({
        id,
        address,
        amountLuna: payout.amountLuna.toString(),
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
      // Uniform public reject shape: no abuse-layer attribution, no
      // deny-vs-review distinction (status code or body). Granular reasons
      // remain in the DB row + claimsTotal Prom metric for operators.
      // See SECURITY.md "Public-API silence on rejection".
      // Pad to T_min to defeat pipeline-position timing attribution
      // (audits/findings-2026-05/024).
      await padRejectDelay(requestStart, T_min);
      return reply.code(403).send({ id, status: 'rejected' });
    }

    if (evaluation.decision === 'challenge') {
      await decrementIpCounter(ctx.db, req.ip, now);
      await ctx.db.insert(claims).values({
        id,
        address,
        amountLuna: payout.amountLuna.toString(),
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
        error: 'challenge required',
      });
    }

    // Automatic-mode payout guard + low-balance scaling. The pipeline has
    // allowed this claim; now derive the actual amount and confirm it is
    // payable. A misconfigured baseline (missing/zero/negative), a reward scaled
    // to zero by a 100% low-balance reduction, or an amount the wallet can't
    // cover must NOT pay out — but it also must not reveal itself: log the real
    // reason server-side and return the SAME opaque reject shape (+ timing pad)
    // as an abuse denial, so a client can't probe the state. Explicit mode keeps
    // its existing behaviour (no claim-time amount/balance gate).
    //
    // `finalPayout` defaults to the baseline `payout`; in automatic mode it is
    // recomputed with the live low-balance settings + balance and used for the
    // send, the DB record, and the audit log below.
    let finalPayout = payout;
    if (ctx.config.automaticRewardsEnabled) {
      // Low-balance threshold + reduction can be overridden live from the admin
      // dashboard (persisted in runtime_config), so resolve effective settings
      // per payout rather than from boot-time config.
      const settings = resolveRewardSettings(ctx.config, await readRuntimeOverrides(ctx.db));

      // Single best-effort balance snapshot, reused for both the scaling
      // decision and the over-balance guard. On a transient getBalance()
      // failure, balance stays null → low-balance scaling is skipped (never
      // halve payouts on a stale read) and the over-balance check is skipped
      // (the send try/catch below still catches a truly insufficient send).
      let balance: bigint | null = null;
      try {
        balance = await ctx.driver.getBalance();
      } catch {
        balance = null;
      }

      // First-time-boost detection. Only run the lookup when a boost is actually
      // configured (zero-cost path otherwise). The current claim isn't inserted
      // until after the send below, so it can't match itself.
      let isFirstTime = false;
      if ((settings.firstTimeBoostPercent ?? 0) > 0) {
        isFirstTime = await isFirstTimeClaimant(ctx.db, {
          ip: req.ip,
          address,
          fingerprintVisitorId,
          hostUid,
          useFingerprint: settings.firstTimeBoostUseFingerprint,
          useUid: settings.firstTimeBoostUseUid,
        });
      }

      // Repeat-user reduction. Only run the windowed count when at least one
      // tier is configured AND at least one identity dimension is enabled
      // (zero-cost path otherwise — no DB hit). Only the windows whose tier is
      // configured are queried.
      //
      // Best-effort, not a hard limit: the count is read here but the row that
      // raises it isn't inserted until after the send below, and `inflightClaims`
      // serializes only on `address`. So concurrent same-IP / same-fingerprint
      // claims to *different* addresses can each read a stale (pre-burst) count
      // and pay full, momentarily defeating the IP/fingerprint tiers under a
      // burst. That's acceptable for a soft anti-farming measure: the atomic
      // per-IP daily cap (incrementIpCounter, before the pipeline) and the
      // per-minute rate limit bound the overpayment per IP per window. (The
      // address dimension is unaffected — same-address bursts lose the
      // inflight race and 429.)
      let repeatReductionPercent = 0;
      const repeatDimEnabled =
        settings.repeatReductionUseAddress ||
        settings.repeatReductionUseIp ||
        settings.repeatReductionUseFingerprint;
      const needDay = isRepeatTierConfigured(
        settings.repeatReductionDailyThreshold,
        settings.repeatReductionDailyPercent,
      );
      const needWeek = isRepeatTierConfigured(
        settings.repeatReductionWeeklyThreshold,
        settings.repeatReductionWeeklyPercent,
      );
      const needMonth = isRepeatTierConfigured(
        settings.repeatReductionMonthlyThreshold,
        settings.repeatReductionMonthlyPercent,
      );
      if (repeatDimEnabled && (needDay || needWeek || needMonth)) {
        const counts = await countRepeatClaims(ctx.db, {
          address,
          ip: req.ip,
          fingerprintVisitorId,
          useAddress: settings.repeatReductionUseAddress,
          useIp: settings.repeatReductionUseIp,
          useFingerprint: settings.repeatReductionUseFingerprint,
          now,
          needDay,
          needWeek,
          needMonth,
        });
        repeatReductionPercent = effectiveRepeatReductionPercent(counts, settings);
      }

      // Whitelist bonus (§2.4.5). Only hit the list when the rule is enabled
      // (zero-cost path otherwise). `hostUid` is the HMAC-gated variable — an
      // unverified uid never reaches the lookup.
      let whitelist: WhitelistMatch | null = null;
      if (settings.whitelistRewardsEnabled) {
        whitelist = await findWhitelistMatch(ctx.db, { address, hostUid });
      }

      const reward = calculateAutomaticReward({
        baselineNim: settings.baselineNim,
        lowBalanceThresholdNim: settings.lowBalanceThresholdNim,
        lowBalanceReductionPercent: settings.lowBalanceReductionPercent,
        firstTimeBoostPercent: settings.firstTimeBoostPercent,
        isFirstTime,
        repeatReductionPercent,
        whitelist,
        whitelistBonusPercent: settings.whitelistBonusPercent,
        balanceLuna: balance,
      });
      finalPayout = { amountLuna: reward.amount, reward };

      let refusal: string | null = null;
      if (reward.baselineAmount <= 0n) {
        refusal = 'automatic_reward_baseline_invalid';
        req.log.error(
          { baselineNim: settings.baselineNim },
          'automatic reward baseline is missing/zero/negative; refusing payout',
        );
      } else if (reward.amount <= 0n) {
        refusal = 'automatic_reward_scaled_to_zero';
        req.log.error(
          {
            baselineAmountLuna: reward.baselineAmount.toString(),
            lowBalanceReductionPercent: settings.lowBalanceReductionPercent,
            repeatReductionPercent,
          },
          'automatic reward scaled to zero by reductions; refusing payout',
        );
      } else if (balance !== null && reward.amount > balance) {
        refusal = 'automatic_reward_exceeds_balance';
        req.log.error(
          { amountLuna: reward.amount.toString(), balance: balance.toString() },
          'automatic reward exceeds available balance; refusing payout',
        );
      }

      if (refusal) {
        await decrementIpCounter(ctx.db, req.ip, now);
        await ctx.db.insert(claims).values({
          id,
          address,
          amountLuna: finalPayout.amountLuna.toString(),
          status: 'rejected',
          ip: req.ip,
          userAgent: claimReq.userAgent ?? null,
          integratorId: integratorId ?? null,
          abuseScore: Math.round(evaluation.score * 1000),
          decision: 'allow',
          signalsJson: JSON.stringify(evaluation.signals),
          rejectionReason: refusal,
          idempotencyKey: parsed.data.idempotencyKey ?? null,
        });
        claimsTotal.inc({ status: 'rejected', decision: 'allow' });
        claimDuration.observe({ phase: 'total' }, (Date.now() - now) / 1000);
        await padRejectDelay(requestStart, T_min);
        return reply.code(403).send({ id, status: 'rejected' });
      }
    }

    // allow — lock per address to prevent duplicate txIds from concurrent
    // requests (the Nimiq node deduplicates identical mempool transactions,
    // so two sends with the same params return the same hash). See #50.
    if (inflightClaims.has(address)) {
      return reply.code(429).send({
        error: 'claim_in_progress',
        code: 'CLAIM_IN_PROGRESS',
        message: 'A claim for this address is already being processed. Try again shortly.',
      });
    }
    inflightClaims.add(address);
    let txId: string;
    try {
      txId = await ctx.driver.send(address, finalPayout.amountLuna);
    } catch (err) {
      inflightClaims.delete(address);
      await decrementIpCounter(ctx.db, req.ip, now);
      if (err instanceof DriverError && err.code === 'RPC_-32602') {
        await padRejectDelay(requestStart, T_min);
        return reply.code(400).send({
          error: 'invalid address',
          code: 'INVALID_ADDRESS',
          message: 'Address rejected by the network (invalid checksum or format)',
        });
      }
      // Record the failed send so it's visible in the activity log.
      const errMsg = err instanceof Error ? err.message : String(err);
      await ctx.db.insert(claims).values({
        id,
        address,
        amountLuna: finalPayout.amountLuna.toString(),
        status: 'timeout',
        ip: req.ip,
        userAgent: claimReq.userAgent ?? null,
        integratorId: integratorId ?? null,
        abuseScore: Math.round(evaluation.score * 1000),
        decision: 'allow',
        signalsJson: JSON.stringify(evaluation.signals),
        rejectionReason: `system error: ${errMsg}`.slice(0, 256),
        idempotencyKey: parsed.data.idempotencyKey ?? null,
      });
      claimsTotal.inc({ status: 'timeout', decision: 'allow' });
      claimDuration.observe({ phase: 'total' }, (Date.now() - now) / 1000);
      await padRejectDelay(requestStart, T_min);
      return reply.code(503).send({
        id,
        status: 'error',
        error: 'send_failed',
        code: 'SEND_FAILED',
        message: 'Faucet is temporarily unavailable. Please try again shortly.',
      });
    }
    await ctx.db.insert(claims).values({
      id,
      address,
      amountLuna: finalPayout.amountLuna.toString(),
      status: 'broadcast',
      txId,
      ip: req.ip,
      userAgent: claimReq.userAgent ?? null,
      integratorId: integratorId ?? null,
      abuseScore: Math.round(evaluation.score * 1000),
      decision: 'allow',
      signalsJson: JSON.stringify(evaluation.signals),
      idempotencyKey: parsed.data.idempotencyKey ?? null,
      // Recorded on the paid row so a later claim's first-time detection can
      // match this identity. (Detection only reads decision='allow' + txId rows.)
      fingerprintVisitorId,
      hostUid,
    });
    inflightClaims.delete(address);
    // Automatic-mode payout: record the reward decision in the log for the audit
    // trail. finalAmount is already persisted via the `amountLuna` column above.
    // TODO(future): persist rewardMode / baselineAmount / adjustments to a
    // dedicated `rewardMetaJson` claims column for richer reporting.
    if (finalPayout.reward) {
      req.log.info(
        {
          rewardMode: finalPayout.reward.rewardMode,
          baselineAmountLuna: finalPayout.reward.baselineAmount.toString(),
          adjustments: finalPayout.reward.adjustments,
          finalAmountLuna: finalPayout.amountLuna.toString(),
        },
        'automatic reward payout',
      );
      for (const adj of finalPayout.reward.adjustments) {
        rewardAdjustmentsTotal.inc({ kind: adj.kind });
      }
    }
    // IP counter was already incremented before the pipeline (see #52 fix above).
    claimsTotal.inc({ status: 'broadcast', decision: 'allow' });
    claimDuration.observe({ phase: 'total' }, (Date.now() - now) / 1000);
    ctx.stream.publish({ type: 'claim.broadcast', id, address, txId });

    // Confirm asynchronously; don't block the response.
    // Issue #84: pass the configured timeout so the driver default
    // (60 s) doesn't prematurely flip a still-valid tx to `timeout`
    // when the network is slow.
    ctx.driver
      .waitForConfirmation(txId, ctx.config.confirmationTimeoutMs)
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
    if (!row) return reply.code(404).send({ error: 'not found', code: 'NOT_FOUND' });
    // Public claim-status response intentionally omits `decision` and
    // `rejectionReason`. Operators querying for granular abuse-pipeline
    // attribution use the admin endpoints (/v1/admin/claims/:id).
    // See SECURITY.md "Public-API silence on rejection".
    return {
      id: row.id,
      status: row.status,
      address: row.address,
      amountLuna: row.amountLuna,
      txId: row.txId,
      createdAt: row.createdAt,
    };
  });

  app.get('/v1/stats', async () => {
    // Public response intentionally omits `byDecision` — that field carried
    // pipeline-effectiveness intelligence (deny/review/allow ratios over
    // the last 100 claims) which violates SECURITY.md "Public-API silence
    // on rejection". Operators see the same data via /v1/admin/overview.
    const recent = await ctx.db
      .select({ id: claims.id, status: claims.status })
      .from(claims)
      .limit(100);
    return {
      total: recent.length,
      byStatus: groupBy(recent.map((r) => r.status)),
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

    // Public response intentionally omits `topRejectionReasons` and the
    // per-row `decision` / `rejectionReason` fields — they leak abuse-layer
    // attribution and contradict SECURITY.md "Public-API silence on
    // rejection". Operators see the same granular data via
    // /v1/admin/overview (topRejectionReasons) and /v1/admin/claims (rows).
    const claimFields = {
      id: claims.id,
      createdAt: claims.createdAt,
      address: claims.address,
      amountLuna: claims.amountLuna,
      status: claims.status,
      txId: claims.txId,
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
    };
    summaryCache = { data, ts: now };
    return data;
  });

  // ── /v1/claims/recent — public paginated claims ──
  // Per SECURITY.md "Public-API silence on rejection": this endpoint
  // intentionally omits `decision` and `rejectionReason` (those carry
  // abuse-layer attribution). Operators get the granular shape via
  // /v1/admin/claims.

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
        txId: claims.txId,
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
