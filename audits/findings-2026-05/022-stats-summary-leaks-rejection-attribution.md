# /v1/stats/summary leaks abuse-layer attribution despite #176's uniformity contract

**Severity:** Medium
**CVSS v3.1:** AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N (4.3)
**Component:** apps/server/src/routes/claim.ts
**Affected versions:** main @ 855868a (introduced before the audit; #176 missed it)

> _The maintainer of this repository has waived the SECURITY.md private-disclosure policy for the duration of this audit; this finding is therefore filed publicly. Downstream forks should NOT inherit this disclosure channel._

## Summary

PR #176 collapsed `POST /v1/claim` reject responses to `403 { id, status: "rejected" }` (no `decision`, no `reason`) and removed `decision`/`rejectionReason` from `GET /v1/claim/:id`'s public shape. The contract is documented in [`SECURITY.md` "Public-API silence on rejection"](../../SECURITY.md). However, the public `GET /v1/stats/summary` endpoint surfaces the exact same abuse-layer attribution that the contract is designed to hide — `topRejectionReasons` carries strings like `"rateLimit: exceeded"` / `"geoip: denied"` / `"hashcash: invalid"`, and `recentClaims` / `recentBlocked` arrays expose `decision` and `rejectionReason` per row.

An attacker can poll this single public endpoint to learn:
1. Which abuse layers fired in the last 24h, ranked by frequency.
2. Per-claim `decision` (`deny` vs `review` vs `allow`) for every row in `recentClaims` + `recentBlocked`.
3. Per-claim `rejectionReason` strings for every row in `recentBlocked`.

This collapses the entire purpose of the uniformity contract. An attacker doesn't need to A/B-test their own claims — the operator's recent-rejections leaderboard is the answer key.

## Location

- [`apps/server/src/routes/claim.ts:465-471`](../../apps/server/src/routes/claim.ts#L465-L471) — `topReasons` query, no auth gate
- [`apps/server/src/routes/claim.ts:480-481`](../../apps/server/src/routes/claim.ts#L480-L481) — `decision` and `rejectionReason` in `claimFields`
- [`apps/server/src/routes/claim.ts:484-498`](../../apps/server/src/routes/claim.ts#L484-L498) — `recentClaims` and `recentBlocked` queries
- [`apps/server/src/routes/claim.ts:514`](../../apps/server/src/routes/claim.ts#L514) — `topRejectionReasons` returned in public response

The endpoint is registered with no `preHandler` for auth (compare with `/v1/admin/*` which goes through `requireAdminSession`). It's gated only by a 30-second in-memory cache (line 434).

## Reproduction

```bash
# Against a faucet with at least one rejected claim in the last 24h
curl -s http://localhost:8080/v1/stats/summary | jq '.topRejectionReasons, .recentBlocked[0]'
```

Expected output (per current code) — abuse-layer attribution is leaked:

```json
[
  { "reason": "rateLimit: exceeded", "count": 12 },
  { "reason": "geoip: denied (KP)", "count": 5 },
  { "reason": "hashcash: invalid", "count": 3 }
]
{
  "id": "...",
  "decision": "deny",
  "rejectionReason": "fingerprint: too many uids",
  ...
}
```

Compare with the contract-compliant response shape from `POST /v1/claim`:

```bash
curl -i -X POST http://localhost:8080/v1/claim -H 'Content-Type: application/json' -d '{}'
# 403 { "id": "...", "status": "rejected" } — no leak
```

## Impact

An attacker can:

1. **Skip the A/B-test phase.** Instead of probing the abuse pipeline by submitting claims and observing response variance, they read the leaderboard directly. This trims hours-to-days of probing to a single GET request.
2. **Enumerate operator thresholds.** `topRejectionReasons` returns concrete strings that include the layer's own classifier output (e.g., `"abuse-ai: score=0.87"`, `"onchain: sweeper detected"`). An attacker tunes their inputs against the specific layer's stated triggers.
3. **Identify dormant layers.** A layer that's enabled but never appears in the top-5 reasons is either rarely-tripped (legitimate users don't fail it) or misconfigured (always allows). Either inference is useful intelligence.
4. **Time the operator's response.** `recentBlocked` shows the most recent 10 rejections with timestamps; an attacker who just submitted a claim can confirm whether their attempt is in the leaderboard, and which layer caught it, near-real-time.

Caveat: severity is capped at Medium because the existing `claimAmountLuna` cap, per-IP rate limit, and abuse-pipeline weighted scoring still bound treasury drain. This finding is "removes a defence-in-depth layer", not "directly drains the wallet".

## Recommended fix

Two options, in order of preference:

### Option A (recommended) — gate the granular fields behind admin auth

Move `topRejectionReasons`, the per-row `decision`, and the per-row `rejectionReason` to an admin-only response shape. Public response keeps:
- `balance` (already public)
- `claims.{1h,24h,7d}` aggregate counts (already public, no change)
- `blocked.{1h,24h,7d}` aggregate counts (no change — total counts don't leak attribution)
- `successRate` (no change)
- `recentClaims`: keep `id`, `createdAt`, `address`, `amountLuna`, `status`, `txId`. Drop `decision` and `rejectionReason`.
- `recentBlocked`: keep `id`, `createdAt`, `address`, `amountLuna`, `status`. Drop `decision`, `rejectionReason`, `txId` (txId on a blocked row is meaningless and may leak driver state).

Admin endpoint `/v1/admin/stats/summary` retains the full shape for operator dashboards.

### Option B — drop the granular fields entirely

If admin tooling already pulls `recentBlocked` from `/v1/admin/claims` (which it does, per [`apps/server/src/routes/admin/claims.ts`](../../apps/server/src/routes/admin/claims.ts)), the public `/v1/stats/summary` doesn't need granular attribution at all. Drop `topRejectionReasons` and the granular per-row fields without adding an admin variant.

Option B is simpler; Option A preserves the operator UX. Either way, regenerate the OpenAPI to match.

## References

- [`SECURITY.md` "Public-API silence on rejection"](../../SECURITY.md) — the contract this endpoint contradicts
- [PR #176](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/176) — the contract's introduction (which missed this endpoint)
- Related CWE: CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor)
