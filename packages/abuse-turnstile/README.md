# @faucet/abuse-turnstile

Cloudflare Turnstile abuse layer. Validates the user-passed Turnstile
token against Cloudflare's siteverify API.

Implements `AbuseCheck` from [@faucet/core](../core/) — registered in
[`apps/server/src/abuse/pipeline.ts`](../../apps/server/src/abuse/pipeline.ts).

## Config

| Env | Purpose |
|-----|---------|
| `FAUCET_TURNSTILE_SITE_KEY` | Public key shown in the claim UI (enables layer) |
| `FAUCET_TURNSTILE_SECRET` | Server-side secret for `challenges.cloudflare.com/turnstile/v0/siteverify` |

## Behaviour

- Requires `req.captchaToken` on the claim request.
- `deny` on failed verification or token replay.
- `allow` when the Turnstile service returns success.
- One outbound call per claim (fast).

## Turnstile vs hCaptcha

Turnstile is the lighter-weight alternative (no checkbox UI in most
cases). Pick one — don't run both simultaneously. See
[`/v1/config`](../../apps/server/src/routes/claim.ts) for how the server
advertises the active provider to clients.

## See also

- Sibling: [@faucet/abuse-hcaptcha](../abuse-hcaptcha/)
- [@faucet/core](../core/) — `AbuseCheck` interface
