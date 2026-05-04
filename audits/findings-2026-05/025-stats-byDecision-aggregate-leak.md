# /v1/stats `byDecision` aggregate counts publicly exposed

**Severity:** Low
**CVSS v3.1:** AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N (4.3) — but information content is low; capping at Low
**Component:** apps/server/src/routes/claim.ts
**Affected versions:** main @ 855868a (introduced before the audit)

> _The maintainer of this repository has waived the SECURITY.md private-disclosure policy for the duration of this audit; this finding is therefore filed publicly. Downstream forks should NOT inherit this disclosure channel._

## Summary

`GET /v1/stats` returns aggregate counts of `decision` values from the most-recent 100 claims:

```json
{ "total": 100, "byStatus": { "broadcast": 60, "rejected": 40 }, "byDecision": { "allow": 60, "deny": 35, "review": 5 } }
```

The `byStatus` map is fine — `broadcast`/`confirmed`/`rejected` are observable to anyone who watches the chain anyway. The `byDecision` map leaks pipeline-effectiveness intelligence: an attacker can compare the deny:review:allow ratio over time and infer whether the operator has tightened or loosened the pipeline.

Lower information density than findings 022 / 023 (this is aggregates, not per-row attribution), so severity is Low. But it's the same root cause — `decision` is operator-internal data that shouldn't reach the public.

## Location

- [`apps/server/src/routes/claim.ts:411-426`](../../apps/server/src/routes/claim.ts#L411-L426) — `/v1/stats` handler
- [`apps/server/src/routes/claim.ts:417`](../../apps/server/src/routes/claim.ts#L417) — `decision: claims.decision` in the SELECT
- [`apps/server/src/routes/claim.ts:424`](../../apps/server/src/routes/claim.ts#L424) — `byDecision: groupBy(recent.map((r) => r.decision))` returned

The endpoint has no auth gate; relies on the global Fastify rate-limit only.

## Reproduction

```bash
curl -s http://localhost:8080/v1/stats | jq '.byDecision'
# { "allow": 60, "deny": 35, "review": 5 }
```

Then poll daily and compute the deny ratio. A 35→60% jump in deny ratio over a week tells the attacker the operator just tightened a layer.

## Impact

- **Operator threshold inference.** Plotting `byDecision` over time reveals when the operator changes pipeline config (e.g., bumping AI deny threshold from 0.85 to 0.75 manifests as a sudden deny-ratio jump).
- **Pipeline-load telemetry.** A `review` count > 0 tells the attacker the review queue is in use; an attacker probing for `review`-bound payloads gets confirmation.

Cap at Low: the operator's deploy timeline is usually visible from GitHub commits anyway, and the abuse pipeline's effectiveness is bounded by the existing `claimAmountLuna` cap. This finding is "remove a small intelligence leak," not "fix an exploit."

## Recommended fix

Drop `byDecision` from the public response. Replace with admin-only `/v1/admin/stats` if operator dashboards need it (they likely already pull from `/v1/admin/claims`).

```ts
// Before
return {
  total: recent.length,
  byStatus: groupBy(recent.map((r) => r.status)),
  byDecision: groupBy(recent.map((r) => r.decision)),
};

// After
return {
  total: recent.length,
  byStatus: groupBy(recent.map((r) => r.status)),
};
```

Drop the `decision: claims.decision` from the SELECT too — there's no other use of that field in the handler post-fix.

## References

- [Finding 022](022-stats-summary-leaks-rejection-attribution.md) and [023](023-claims-recent-leaks-decision-and-reason.md) — same root cause, higher-information siblings
- Related CWE: CWE-200
