# Device Fingerprint Correlation

Browser fingerprint correlation layer that uses FingerprintJS visitor IDs to detect multi-account farming and sybil attacks. Tracks the relationship between browser fingerprints, user IDs, and cookies over a rolling time window.

## How it works

1. The integrator's frontend collects a FingerprintJS visitor ID and passes it in the claim's `fingerprint` field
2. The server persists `(visitorId, uid, cookieHash, seenAt)` tuples in the database
3. On each claim, the layer queries the rolling window to check:
   - **Visitor-to-UID fan-out:** Same browser fingerprint claiming with many different user IDs → sybil detection
   - **UID-to-visitor fan-out:** Same user ID seen from many different browsers → multi-device farming
   - **Cross-integrator reuse:** Same visitor seen across different integrator apps → account sharing
4. Trust is boosted when the `hostContext` is HMAC-signed by a verified integrator

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `FAUCET_FINGERPRINT_ENABLED` | `false` | Enable the fingerprint layer |
| `FAUCET_FINGERPRINT_WINDOW_MS` | `86400000` | Rolling window (default 24 hours) |
| `FAUCET_FINGERPRINT_MAX_VISITORS_PER_UID` | `3` | Max distinct browsers per user ID before score bump |
| `FAUCET_FINGERPRINT_MAX_UIDS_PER_VISITOR` | `3` | Max user IDs per browser before review |

## Decision logic

- **Fan-out within thresholds:** `allow` with low score
- **Visitor-to-UID exceeds max:** `allow` with elevated score (pipeline may deny based on aggregate)
- **Cross-integrator reuse detected:** `review` for manual inspection
- **HMAC-signed hostContext:** trust boost (lower score)

## Trade-offs

- **Effective against** multi-account farming (same person, many accounts)
- **Requires integrator cooperation** — the frontend must send fingerprint data
- **Privacy considerations** — stores browser fingerprint hashes in the database
- **Client-side collection** via FingerprintJS (free open-source tier available)

## Integrator integration

To use this layer, integrators must:

1. Include [FingerprintJS](https://fingerprint.com/) in their frontend
2. Pass the `visitorId` in the claim request's `fingerprint` field
3. Optionally sign the `hostContext` with HMAC for trust boost (see [integrator-hmac.md](../integrator-hmac.md))
