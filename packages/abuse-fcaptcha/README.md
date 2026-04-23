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
| `FAUCET_FCAPTCHA_URL` | Base URL of the FCaptcha service (enables layer) |
| `FAUCET_FCAPTCHA_SITE_KEY` | Public key passed to the widget in the claim UI |
| `FAUCET_FCAPTCHA_SECRET` | Server-side secret for token verification |

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
