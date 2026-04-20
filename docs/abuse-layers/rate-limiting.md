# Rate Limiting

Per-IP daily claim cap that prevents the same IP from making too many claims within a 24-hour window. This is the primary volume-abuse defense and is always enabled.

## How it works

Each claim request increments a counter keyed by `(IP, UTC day)`. Before the abuse pipeline evaluates the claim, the counter is already incremented (to close the TOCTOU window for concurrent requests). If the counter exceeds the configured cap, the claim is denied.

Below the cap, the layer contributes a proportional score: `min(count / cap, 0.6)`, providing a graduated signal to the pipeline's aggregate scoring.

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `FAUCET_RATE_LIMIT_PER_IP_PER_DAY` | `5` | Maximum claims per IP per UTC day |
| `FAUCET_RATE_LIMIT_PER_MINUTE` | `30` | Server-wide HTTP rate limit (Fastify plugin, separate from pipeline) |

The per-IP daily cap is the abuse pipeline layer. The per-minute limit is a server-wide Fastify plugin that fires before route handlers — it returns HTTP 429 and does not create a claim record.

## Decision logic

- **Count > cap:** `deny` with reason "ip reached daily cap (N/cap)"
- **Count <= cap:** `allow` with score proportional to usage

## Trade-offs

- **Simple and effective** for casual abuse
- **Easy to bypass** with IP rotation (VPN, proxy, Tor) — pair with GeoIP and fingerprint layers
- Counters reset at UTC midnight — no sliding window
