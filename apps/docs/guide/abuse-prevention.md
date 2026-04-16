# Abuse prevention

The faucet runs every claim through a deterministic pipeline of checks. Each
layer returns a signed signal; the decision engine aggregates them into a final
score and one of `allow`, `review`, or `deny`.

## Pipeline order

1. **Transport & rate limits** — per-minute global cap, per-IP daily cap, CORS.
2. **Blocklist** — exact matches on `ip`, `address`, `uid`, `asn`, `country`.
3. **Hashcash** — client puzzle, required when `FAUCET_HASHCASH_SECRET` is set.
4. **Captcha** — Turnstile or hCaptcha, required when configured.
5. **GeoIP / ASN / VPN / Tor / hosting** — offline MaxMind or online IPinfo.
6. **On-chain Nimiq heuristics** — address age, balance, activity.
7. **Host context** — signed signals from the integrator (see [Host context](./host-context.md)).
8. **LLM scoring** — optional final gate, off by default.

Each layer contributes a weighted score; layers can short-circuit with a hard
`deny` (blocklist hit, failed captcha, TLS missing, etc.).

## Thresholds

Defaults in `@faucet/core`:

| Outcome | Score range |
| --- | --- |
| `allow` | `score <= 30` |
| `review` | `31..70` |
| `deny` | `>= 71` or any hard-deny layer |

`review` responses still get a 200 with `decision: "review"` so integrators
can queue manual approval. The admin dashboard surfaces all `review` rows.

## Layer reference

| Layer | Package | Env toggle |
| --- | --- | --- |
| Rate limit | `@faucet/core` | `FAUCET_RATE_LIMIT_*` |
| Blocklist | `@faucet/core` | built-in |
| Hashcash | `@faucet/abuse-hashcash` | `FAUCET_HASHCASH_SECRET` |
| Turnstile | `@faucet/abuse-turnstile` | `FAUCET_TURNSTILE_*` |
| hCaptcha | `@faucet/abuse-hcaptcha` | `FAUCET_HCAPTCHA_*` |
| GeoIP | `@faucet/abuse-geoip` | `FAUCET_GEOIP_BACKEND` |
| Fingerprint | `@faucet/abuse-fingerprint` | built-in |
| Nimiq on-chain | `@faucet/abuse-onchain-nimiq` | built-in |
| LLM scoring | `@faucet/abuse-ai` | off unless configured |

## Debugging a decision

Every claim row stores `decision`, `abuseScore`, `rejectionReason`, and the
full `signalsJson`. Fetch it with the admin MCP tool:

```bash
mcp call faucet.explain_decision --arg claimId=clm_123
```

Or via the dashboard's claim detail panel.
