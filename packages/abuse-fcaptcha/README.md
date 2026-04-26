# @faucet/abuse-fcaptcha

FCaptcha abuse layer. Validates a FCaptcha token produced by the client
widget against the self-hosted FCaptcha service's `/api/token/verify`
endpoint before allowing a claim.

Upstream: [WebDecoy/FCaptcha](https://github.com/WebDecoy/FCaptcha) (MIT).
This package is a **thin driver**; all detection logic (behavioural
signals, environmental probes, PoW issuance, scoring) lives upstream.
We do not fork FCaptcha's internals.

Implements `AbuseCheck` from [@faucet/core](../core/) — registered in
[`apps/server/src/abuse/pipeline.ts`](../../apps/server/src/abuse/pipeline.ts).

## Config

| Env | Purpose |
|-----|---------|
| `FAUCET_FCAPTCHA_PUBLIC_URL` | URL the **browser** fetches the widget from. Must be reachable from end-user devices. Returned in `/v1/config.captcha.serverUrl`. |
| `FAUCET_FCAPTCHA_INTERNAL_URL` | URL the **faucet server** hits to verify tokens. Defaults to `FAUCET_FCAPTCHA_PUBLIC_URL`; override when running fcaptcha on a sidecar (e.g. `http://fcaptcha:3000` on a Docker bridge). |
| `FAUCET_FCAPTCHA_SITE_KEY` | Public key passed to the widget in the claim UI |
| `FAUCET_FCAPTCHA_SECRET` | Server-side secret for token verification |
| `FAUCET_FCAPTCHA_URL` | **Deprecated** (issue #118) — single var that conflated server/browser URLs. Still honoured for one minor as a fallback for both `*_PUBLIC_URL` and `*_INTERNAL_URL`; migrate to the split above. |

### Why two URLs?

In dev, fcaptcha typically runs on a separate Docker service. The faucet
container reaches it on the bridge network at `http://fcaptcha:3000`,
but a phone on the same Wi-Fi can't resolve `fcaptcha`. It needs the
LAN-reachable URL (e.g. `http://192.168.1.50:3000`).

In production, both are usually the same public HTTPS URL fronted by
a reverse proxy. Setting only `*_PUBLIC_URL` is fine — `*_INTERNAL_URL`
defaults to it.

## Behaviour

- Requires `req.captchaToken` on the claim request.
- `deny` if verification fails or token missing.
- `allow` when the verify call returns `{ valid: true }`; the service's
  score (0 = clean, 1 = abusive) becomes the check score.
- One outbound network call per claim against the operator's own
  FCaptcha service — no third-party traffic.

## See also

- Sibling: [@faucet/abuse-hcaptcha](../abuse-hcaptcha/) (hosted hCaptcha)
- [@faucet/core](../core/) — `AbuseCheck` interface
