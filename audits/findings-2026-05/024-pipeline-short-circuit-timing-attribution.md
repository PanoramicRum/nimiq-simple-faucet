# Pipeline short-circuits on hard `deny` — timing side-channel attribution

**Severity:** Medium
**CVSS v3.1:** AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N (3.7)
**Component:** packages/core/src/pipeline.ts
**Affected versions:** main @ 855868a (since the pipeline was introduced; not specifically a #176 regression)

> _The maintainer of this repository has waived the SECURITY.md private-disclosure policy for the duration of this audit; this finding is therefore filed publicly. Downstream forks should NOT inherit this disclosure channel._

## Summary

PR #176 made every `/v1/claim` reject body byte-shape-identical so an attacker can't tell which abuse layer fired by reading the response. But the pipeline that decides the rejection still **short-circuits** on the first hard `deny`: [`packages/core/src/pipeline.ts:74-77`](../../packages/core/src/pipeline.ts#L74-L77) breaks out of the loop, and [line 58](../../packages/core/src/pipeline.ts#L58) does the same on a check error. As a result, the response time correlates strongly with the *position* of the firing layer in the pipeline — a side-channel that defeats the body-uniformity contract.

Approximate latencies (per-layer, rough order of magnitude, depends on operator config):

| Pipeline position | Layer | Typical latency | Why |
|---|---|---|---|
| 1 | `rateLimit` | ~5 ms | DB lookup |
| 2 | `blocklist` | ~10 ms | DB lookup |
| 3 | `hashcash` | ~1 ms | HMAC verify, replay-cache lookup |
| 4 | `geoip` | ~15 ms | DB lookup (MaxMind / DB-IP) |
| 5 | `fingerprint` | ~30 ms | DB query (UID counting) |
| 6 | `captcha` | ~600–1500 ms | HTTP fetch to Cloudflare/hCaptcha/FCaptcha |
| 7 | `onchain` | ~200–500 ms | RPC call to Nimiq node |
| 8 | `abuse-ai` | ~1000–2000 ms | ONNX inference (or HTTP to model server) |

A 5ms response is rate-limit; a 1500ms response is captcha. The body says nothing, but the wire speaks.

## Location

- [`packages/core/src/pipeline.ts:74-77`](../../packages/core/src/pipeline.ts#L74-L77) — `if (result.decision === 'deny') { hardDecision = 'deny'; break; }`
- [`packages/core/src/pipeline.ts:58`](../../packages/core/src/pipeline.ts#L58) — `break;` on per-check error path
- [`apps/server/src/routes/claim.ts:254`](../../apps/server/src/routes/claim.ts#L254) — `await ctx.pipeline.evaluate(claimReq)` is the only awaitable between request receipt and reject body

## Reproduction

```bash
# 1. Boot the faucet with a real abuse pipeline (turnstile + geoip + rateLimit at minimum)
# 2. Submit claims in three different rejection profiles and time them:

# Profile A: rate-limit (burn quota first, then submit)
for i in {1..6}; do curl -s -o /dev/null -w "%{time_total}\n" \
  -X POST http://localhost:8080/v1/claim \
  -H 'Content-Type: application/json' \
  -d '{"address":"NQ00 ..."}' ; done
# 6th request: ~5–15 ms (rate-limit fires immediately)

# Profile B: bad captcha token (rate-limit passes, captcha rejects)
curl -s -o /dev/null -w "%{time_total}\n" \
  -X POST http://localhost:8080/v1/claim \
  -H 'Content-Type: application/json' \
  -d '{"address":"NQ00 ...","captchaToken":"INVALID"}'
# Response: ~600–1500 ms (captcha provider HTTP fetch)

# Profile C: blocked country (rate-limit + captcha pass, geoip rejects)
curl -s -o /dev/null -w "%{time_total}\n" \
  -X POST http://localhost:8080/v1/claim \
  -H 'Content-Type: application/json' \
  -H 'X-Forwarded-For: <IP-in-blocked-country>' \
  -d '{"address":"NQ00 ...","captchaToken":"<valid>"}'
# Response: ~30–60 ms (geoip lookup after rate-limit + blocklist + hashcash)
```

The response BODIES are identical (`403 { id, status: "rejected" }`); only the wall-clock differs. With ~10 samples per profile an attacker can rank-order the layers they tripped.

## Impact

Defence-in-depth on top of body uniformity. The body contract (#176) closes the dictionary-attack channel; this finding closes the timing-side-channel attack. Without this fix, the body uniformity is *necessary but not sufficient*.

A motivated attacker who has already shipped one client and watches their response times can:

1. Distinguish "rate-limited" (cheap) from "AI-flagged" (expensive) — and time-multiplex their probe accordingly.
2. Detect when the operator changes pipeline config (a layer's typical latency changes; the timing distribution shifts).
3. Identify which layers are enabled at all (a layer that's never seen in the timing distribution is likely off).

Severity is Medium with high-attack-complexity (AC:H) because it requires multiple samples and statistical analysis, and the existing body uniformity already takes a real bite out of the original attack.

## Recommended fix

Three options, each with tradeoffs:

### Option A — always run all checks; aggregate at the end

Stop breaking on `deny`. Run every check, accumulate results, then compute the cumulative decision. Code sketch:

```ts
async evaluate(req: ClaimRequest): Promise<PipelineResult> {
  const perCheck = await Promise.all(
    this.checks.map(async (c) => {
      try {
        const result = await c.check(req);
        return { id: c.id, ...result };
      } catch (err) {
        return {
          id: c.id, score: 1,
          signals: { error: err instanceof Error ? err.message : String(err) },
          decision: 'deny' as const,
        };
      }
    }),
  );
  // Collapse to cumulative decision: any deny → deny; else weighted score.
  const decision = perCheck.some((r) => r.decision === 'deny')
    ? 'deny'
    : this.decisionFromScore(weightedScore(perCheck));
  // ... build other PipelineResult fields
}
```

Cost: every claim now pays the slowest layer's latency (~2s with AI enabled), even if rate-limit would have fired in 5ms. That's a real UX regression for legitimate rate-limit hits ("retry in 24h"), and a DoS-amplification risk if AI inference is expensive.

### Option B — pad the response to a constant target latency

Keep the existing short-circuit but add a `setTimeout`/`sleep` after the pipeline call so every reject takes at least `T_min` (e.g., 1500ms — the slowest typical layer's latency). Code sketch:

```ts
// Inside the deny branch in claim.ts
const startedAt = Date.now();
// ... existing pipeline + DB write ...
const elapsed = Date.now() - startedAt;
const PADDING_MS = 1500;
if (elapsed < PADDING_MS) {
  await new Promise((r) => setTimeout(r, PADDING_MS - elapsed));
}
return reply.code(403).send({ id, status: 'rejected' });
```

Cost: doubles the rate-limit-deny latency from 5ms to 1500ms, but only for rejected claims (allowed claims are unaffected). DoS-resistant because the padding is server-side `setTimeout`, not blocking.

Important nuance: padding must apply to **all** reject paths, not just deny — otherwise the existence of a 1500ms-padded response vs an unpadded 30ms response itself signals "you tripped the abuse pipeline" vs "you tripped a pre-pipeline check". Also pad the `invalid request` (Zod), `invalid address`, and `integrator auth failed` paths to the same `T_min`.

### Option C — randomised jitter

Add `setTimeout(rng() * 2000)` to every reject. Cheaper than B but only buys statistical noise — with enough samples the underlying distribution still leaks. Not recommended over B.

**Recommendation: Option B with `T_min = 1500ms` applied to every public reject path** (deny, review, Zod-invalid, integrator-auth-failed, invalid-address). Option A's "run everything" is theoretically cleaner but the UX cost is real for legitimate rate-limit hits. Option B is what every modern login form does for the same reason.

## References

- [`SECURITY.md` "Public-API silence on rejection"](../../SECURITY.md) — the contract this finding extends with timing concerns
- [PR #176 "Out of scope" section](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/176) — explicitly flagged "constant-time response delivery" as orthogonal hardening; this finding makes the case for prioritising it
- Related CWE: CWE-208 (Observable Timing Discrepancy)
