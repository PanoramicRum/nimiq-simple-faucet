# adminMcpAllowStaticToken defaults to `true` indefinitely; no boot-time warning, no expiry

**Severity:** Low
**CVSS v3.1:** AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H (5.6) — capped at Low because exploitation requires prior token leak
**Component:** apps/server/src/config.ts
**Affected versions:** main @ 855868a (introduced as part of the #88 fix's compat layer)

> _The maintainer of this repository has waived the SECURITY.md private-disclosure policy for the duration of this audit; this finding is therefore filed publicly. Downstream forks should NOT inherit this disclosure channel._

## Summary

The original audit's finding [#88](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/88) replaced the static MCP bearer token with a session+TOTP auth path. To avoid breaking existing deployments, the fix introduced a feature flag `adminMcpAllowStaticToken` that defaults to `true`, with a comment promising "flip to `false` once you've migrated":

```ts
// apps/server/src/config.ts:106-110
/** When false, the static `adminMcpToken` is ignored and the only way to
 *  invoke admin MCP tools is a valid admin session cookie + TOTP step-up.
 *  Default `true` for one minor so current deployments keep working; flip
 *  to `false` once you've migrated to the session path. */
adminMcpAllowStaticToken: z.coerce.boolean().default(true),
```

The "one minor" promise is a comment, not a constraint. There is:
- No boot-time `WARN` when `adminMcpAllowStaticToken=true` and `adminMcpToken` is set.
- No deprecation timestamp in the comment.
- No CI check that the default flips.
- No mechanism to surface to operators that they're still on the legacy auth path.

In practice, operators upgrade through versions, never see a breakage, and stay on the static-token path indefinitely. If the static token leaks (logs, CI artifacts, env-var dumps in error reports), an attacker retains MCP access — re-opening the original #88 attack window.

## Location

- [`apps/server/src/config.ts:110`](../../apps/server/src/config.ts#L110) — `default(true)`
- [`apps/server/src/mcp/index.ts`](../../apps/server/src/mcp/index.ts) — `resolveAdminPrincipal()` reads `config.adminMcpAllowStaticToken` (per Agent A's exploration); honours legacy path when `true`

## Reproduction

```bash
# Operator deploys v3.0.17 (or whatever version landed the #88 fix), keeps env unchanged:
FAUCET_ADMIN_MCP_TOKEN=xxxxxxxx (legacy, still in env)
# adminMcpAllowStaticToken (env var FAUCET_ADMIN_MCP_ALLOW_STATIC_TOKEN) — unset → defaults to true

# Months pass. Operator forgets the migration TODO.
# Token leaks via:
# - GitHub Actions log secret-redaction failure
# - Operator error-tracking system (Sentry/Bugsnag) capturing env in a stack trace
# - Old deploy-config repo with the secret committed pre-rotation

# Attacker uses leaked token:
curl -X POST http://faucet/mcp \
  -H 'Authorization: Bearer xxxxxxxx' \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"send","arguments":{"address":"NQ00 ATTACKER","amountLuna":"100000000"}}}'
# Static-token path still works → tools/call succeeds → wallet drained at the rate-limit cap
```

The original #88 fix didn't make this attack impossible; it made it opt-out, then forgot to flip the opt-out.

## Impact

This is a regression-of-spirit, not a regression-of-code. The fix landed; the spirit was "force operators onto session auth"; the implementation parked at "make session auth optional". Severity Low because:

1. Exploitation requires the static token to leak — same precondition as the original #88 finding.
2. Mitigations exist: operators *can* set `FAUCET_ADMIN_MCP_ALLOW_STATIC_TOKEN=false`. They just don't, because no signal tells them to.
3. The blast radius is bounded by `claimAmountLuna` per call + per-IP rate limit; an attacker can drain over hours, not seconds.

## Recommended fix

Three layers of mitigation, in order of preference:

### Fix 1 (recommended) — flip the default to `false` in the next minor

Two-step:

1. **This release**: emit a boot-time `WARN` log whenever `adminMcpToken` is set AND `adminMcpAllowStaticToken` is `true` (its default), naming the flag and the deprecation timeline:
   ```
   [DEPRECATION] FAUCET_ADMIN_MCP_TOKEN is set with FAUCET_ADMIN_MCP_ALLOW_STATIC_TOKEN
   defaulting to true. The static-token path will be DISABLED by default in the next
   minor release. Migrate to session+TOTP auth (see docs/admin-mcp.md) and set
   FAUCET_ADMIN_MCP_ALLOW_STATIC_TOKEN=false to silence this warning.
   ```
2. **Next minor**: change `default(true)` to `default(false)`. Document in CHANGELOG as a breaking change with the migration path.

### Fix 2 — alternatively, keep the default but add hard-stop on absence of session

If flipping the default is too disruptive, at minimum require operators to *explicitly* opt-in:
- Treat `adminMcpAllowStaticToken=true` as ambiguous; require operators to set it explicitly (e.g., schema fails to parse if `adminMcpToken` is set without an explicit `adminMcpAllowStaticToken`).
- This forces a deliberate decision per deployment.

### Fix 3 — log every static-token use as a deprecation warning

In `resolveAdminPrincipal()` (per Agent A's notes, [`apps/server/src/mcp/index.ts:55-100`](../../apps/server/src/mcp/index.ts#L55-L100)), when the static-token branch wins, log:
```
[DEPRECATION] Admin MCP request authenticated via legacy static token. Migrate to session auth.
```
Sample at 1-in-100 to avoid log floods. This makes the legacy path *visible* to operators monitoring their logs, even if they don't read the boot warning.

Recommend **Fix 1 + Fix 3 together**: boot warning for visibility, per-call deprecation log for operators who only check during incidents, default-flip in the next minor for the actual hardening.

## References

- [Original audit finding #88](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/88) — the static-token vulnerability this fix addressed
- [`SECURITY.md` "Trust-boundary model"](../../SECURITY.md) — admin auth section
- Related CWE: CWE-672 (Use of Expired or Released Resource), CWE-285 (Improper Authorization)
