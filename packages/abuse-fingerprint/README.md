# @faucet/abuse-fingerprint

Browser-fingerprint abuse layer. Correlates FingerprintJS visitor IDs
with host-supplied UIDs to detect multi-account abuse.

Implements `AbuseCheck` from [@faucet/core](../core/) — registered in
[`apps/server/src/abuse/pipeline.ts`](../../apps/server/src/abuse/pipeline.ts).

## Config

| Env | Default | Purpose |
|-----|---------|---------|
| `FAUCET_FINGERPRINT_ENABLED` | `false` | Set `true` to enable |
| `FAUCET_FINGERPRINT_WINDOW_MS` | `86400000` | Rolling window (24 h default) |
| `FAUCET_FINGERPRINT_MAX_VISITORS_PER_UID` | `3` | Above this threshold → score bump |
| `FAUCET_FINGERPRINT_MAX_UIDS_PER_VISITOR` | `3` | Cross-integrator reuse → review |

## Behaviour

- Persists `(visitorId, uid, cookieHash, seenAt)` rows within the
  rolling window.
- `allow` + high score when the visitor-to-UID fan-out crosses the
  configured threshold (possible sybil).
- `review` on cross-integrator reuse (same visitor across multiple
  `hostContext.uid` values).
- Trust is boosted when `hostContext` is signed via integrator HMAC —
  see [docs/integrator-hmac.md](../../docs/integrator-hmac.md).

## See also

- [@faucet/core](../core/) — `AbuseCheck` + `HostContext` interface
