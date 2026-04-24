# @faucet/abuse-hcaptcha

hCaptcha abuse layer. Validates a human-presented hCaptcha token against
the hCaptcha verify API before allowing a claim.

Implements `AbuseCheck` from [@faucet/core](../core/) — registered in
[`apps/server/src/abuse/pipeline.ts`](../../apps/server/src/abuse/pipeline.ts).

## Config

| Env | Purpose |
|-----|---------|
| `FAUCET_HCAPTCHA_SITE_KEY` | Public key shown in the claim UI (enables layer) |
| `FAUCET_HCAPTCHA_SECRET` | Server-side secret used with `hcaptcha.com/siteverify` |

## Behaviour

- Requires `req.captchaToken` on the claim request.
- `deny` if verification fails or token reused.
- `allow` when the score passes the hCaptcha-determined threshold.
- One outbound network call per claim (fast; <200 ms typical).

## See also

- Sibling: [@faucet/abuse-turnstile](../abuse-turnstile/) (Cloudflare Turnstile)
- Sibling: [@faucet/abuse-fcaptcha](../abuse-fcaptcha/) (self-hosted FCaptcha)
- [@faucet/core](../core/) — `AbuseCheck` interface
