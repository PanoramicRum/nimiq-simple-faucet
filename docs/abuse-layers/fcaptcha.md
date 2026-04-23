# FCaptcha

Self-hosted, MIT-licensed CAPTCHA service that combines SHA-256 proof-of-work with behavioural and environmental bot detection (mouse trajectory, micro-tremor, click precision, WebDriver probes, typing rhythm). Offered in interactive-checkbox and invisible zero-click modes.

Upstream project: [github.com/WebDecoy/FCaptcha](https://github.com/WebDecoy/FCaptcha). The faucet integrates FCaptcha as a thin driver — we never fork the detection code. Deploy FCaptcha as a sidecar, point the faucet at it.

## How it works

1. The ClaimUI loads `/fcaptcha.js` from the operator's FCaptcha service and renders the widget.
2. The widget collects behavioural signals, solves the PoW challenge, and exchanges them at FCaptcha's `/api/verify` endpoint for a verification token.
3. The client includes the token in the claim request as `captchaToken`.
4. The faucet server calls FCaptcha's `/api/token/verify` with `{ token, secret }` and reads `{ valid, score, … }`.
5. If `valid` is true, the claim proceeds; otherwise it's denied.

All traffic stays between the operator's faucet, the operator's FCaptcha service, and the end user's browser. No third-party calls.

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `FAUCET_FCAPTCHA_URL` | _(unset = disabled)_ | Base URL of the FCaptcha service, e.g. `http://fcaptcha:3000` |
| `FAUCET_FCAPTCHA_SITE_KEY` | _(unset)_ | Public site key; passed to the browser widget |
| `FAUCET_FCAPTCHA_SECRET` | _(unset)_ | Server-side secret for token verification |

All three are required to enable the layer. If any is missing the driver isn't registered and the `fcaptcha` entry in `/v1/config.abuseLayers` stays `false`.

### Deploy FCaptcha alongside the faucet

A compose overlay is provided:

```bash
cd deploy/compose
docker compose -f docker-compose.yml -f fcaptcha.yml up -d
```

Set `FCAPTCHA_SECRET`, `FAUCET_FCAPTCHA_URL`, `FAUCET_FCAPTCHA_SITE_KEY`, and `FAUCET_FCAPTCHA_SECRET` in `.env` before bringing the stack up. See the upstream [FCaptcha README](https://github.com/WebDecoy/FCaptcha) for site-key generation.

## Decision logic

- **No token provided:** `deny` with reason "missing captcha token".
- **`/api/token/verify` returns `valid: false`:** `deny` with the upstream error surfaced in signals.
- **Verify succeeds:** `allow` using FCaptcha's returned `score` (clamped to [0, 1], 0 = clean, 1 = abusive).

## Trade-offs

- **Self-hosted, no third-party calls** — FCaptcha runs as a sidecar container you own.
- **Richer than pure-PoW alternatives** (hashcash, ALTCHA, Cap) — behavioural + environmental signals alongside the proof-of-work backbone.
- **Requires running a second service** — one container, optional Redis for distributed state. For single-node deployments, the in-memory store is sufficient.
- **Mutually exclusive with Turnstile / hCaptcha** — the claim UI renders one captcha widget at a time. Pick the provider that matches your threat model.

## Reuse, not reinvent

FCaptcha's behavioural scoring, PoW issuance, and token verification all live in its own service. The faucet's `packages/abuse-fcaptcha` driver is ~60 lines — it's an HTTP client, nothing more. If you want to tune detection (difficulty, signal weights, datacenter-IP heuristics), configure FCaptcha itself. If you find a gap, contribute upstream.

## See also

- [FCaptcha upstream](https://github.com/WebDecoy/FCaptcha)
- [`@faucet/abuse-fcaptcha`](../../packages/abuse-fcaptcha/) — driver package
- [Turnstile](./turnstile.md), [hCaptcha](./hcaptcha.md), [Hashcash](./hashcash.md) — sibling layers
