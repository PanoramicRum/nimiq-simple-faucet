# /v1/claims/recent exposes decision + rejectionReason despite "no sensitive fields" comment

**Severity:** Medium
**CVSS v3.1:** AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N (4.3)
**Component:** apps/server/src/routes/claim.ts
**Affected versions:** main @ 855868a (introduced before the audit; #176 missed it)

> _The maintainer of this repository has waived the SECURITY.md private-disclosure policy for the duration of this audit; this finding is therefore filed publicly. Downstream forks should NOT inherit this disclosure channel._

## Summary

The public `GET /v1/claims/recent` endpoint returns a paginated list of recent claims and includes `decision` + `rejectionReason` per row. Worse, the section header at line 520 reads `"// ── /v1/claims/recent — public paginated claims (no sensitive fields) ──"` while the code immediately below selects exactly those sensitive fields. The comment is a misleading invariant claim that the code does not honour.

This is the same contract violation as finding 022 (the [`SECURITY.md` "Public-API silence on rejection"](../../SECURITY.md) contract), but on a different endpoint. The endpoint is parameterised (`?status=rejected&limit=100&offset=...`), which makes it more dangerous than `/v1/stats/summary`'s fixed top-10: an attacker can paginate the *entire* rejected-claims history at 100 rows per page.

## Location

- [`apps/server/src/routes/claim.ts:520`](../../apps/server/src/routes/claim.ts#L520) — misleading "no sensitive fields" comment
- [`apps/server/src/routes/claim.ts:537-539`](../../apps/server/src/routes/claim.ts#L537-L539) — `decision` and `rejectionReason` selected and returned
- [`apps/server/src/routes/claim.ts:522-554`](../../apps/server/src/routes/claim.ts#L522-L554) — handler registered with no `preHandler` (no auth gate, no rate limit beyond the global Fastify one)

## Reproduction

```bash
# Page through every rejected claim, learning the abuse layer that fired for each
curl -s "http://localhost:8080/v1/claims/recent?status=rejected&limit=100&offset=0" | \
  jq '.items[] | {id, decision, rejectionReason}'
```

Expected output:

```json
{ "id": "abc123", "decision": "deny", "rejectionReason": "rateLimit: exceeded" }
{ "id": "def456", "decision": "deny", "rejectionReason": "geoip: denied (KP)" }
{ "id": "ghi789", "decision": "review", "rejectionReason": "abuse-ai: score=0.78" }
...
```

The maximum `limit` is clamped to 100 at [line 524](../../apps/server/src/routes/claim.ts#L524), but `offset` is unbounded — an attacker can walk the full history.

## Impact

Same as finding 022 plus:

1. **Long-tail enumeration.** `/v1/stats/summary` shows only the top 5 reasons by count; `/v1/claims/recent` exposes every individual rejection. Rare layer triggers (e.g., one user tripped `onchain: sweeper detected`) become visible.
2. **Targeting victims.** The endpoint also returns `address` (line 534). An attacker can map: "address X had its claim denied by `onchain: heuristic-Y`" — a privacy/profiling concern beyond just abuse-layer enumeration. (Addresses in faucets are often pseudonymously linked to one wallet.)
3. **Operator misled by the comment.** A future maintainer reading line 520 would conclude the endpoint is hardened. They might add MORE sensitive fields, mistakenly believing the gate is somewhere upstream.

## Recommended fix

Same shape as finding 022's Option A or B. Concrete changes:

```ts
// apps/server/src/routes/claim.ts L530-545 (BEFORE)
const rowsRaw = await ctx.db.select({
  id: claims.id,
  createdAt: claims.createdAt,
  address: claims.address,
  amountLuna: claims.amountLuna,
  status: claims.status,
  decision: claims.decision,         // DROP
  txId: claims.txId,
  rejectionReason: claims.rejectionReason,  // DROP
}).from(claims).where(conds).orderBy(...).limit(...);

// AFTER
const rowsRaw = await ctx.db.select({
  id: claims.id,
  createdAt: claims.createdAt,
  address: claims.address,           // see note below
  amountLuna: claims.amountLuna,
  status: claims.status,
  txId: claims.txId,                 // null on rejected rows; OK to keep
}).from(claims).where(conds).orderBy(...).limit(...);
```

Also fix the line-520 comment to actually describe what's exposed, or delete it entirely.

**Note on `address`**: leaving `address` in the public response is consistent with `/v1/claim/:id` and keeps the explorer UX (operators want to confirm "did this address get a claim?"). The privacy concern in §Impact item 2 is genuine but separable; defer to a future hardening pass.

## References

- [Finding 022](022-stats-summary-leaks-rejection-attribution.md) — same contract violation on a different endpoint; share the fix
- [`SECURITY.md` "Public-API silence on rejection"](../../SECURITY.md)
- Related CWE: CWE-200, CWE-359 (Exposure of Private Personal Information)
