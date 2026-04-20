# Cloudflare Turnstile

Invisible human-presence challenge powered by Cloudflare's Turnstile service. Verifies that the client is a real browser controlled by a human, without requiring the user to solve a visual puzzle.

## How it works

1. The ClaimUI (or integrator's frontend) loads the Turnstile widget using the public site key
2. Turnstile runs background checks (browser fingerprint, behavior analysis) and issues a token
3. The client includes the token in the claim request as `captchaToken`
4. The server verifies the token against Cloudflare's `siteverify` endpoint
5. If verification passes, the claim proceeds; if it fails, the claim is denied

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `FAUCET_TURNSTILE_SITE_KEY` | _(unset = disabled)_ | Public site key from Cloudflare dashboard |
| `FAUCET_TURNSTILE_SECRET` | _(unset)_ | Server-side secret for verification |

Setting `FAUCET_TURNSTILE_SITE_KEY` enables the layer. Both the site key and secret are required.

### Getting credentials

1. Go to [Cloudflare Dashboard > Turnstile](https://dash.cloudflare.com/turnstile)
2. Add a site and configure the widget type (managed, non-interactive, or invisible)
3. Copy the site key and secret key

## Decision logic

- **No token provided:** `deny` with reason "captcha token required"
- **Token verification fails:** `deny` with reason "captcha verification failed"
- **Token valid:** `allow` with score 0

## Trade-offs

- **Free tier** available (up to 1M verifications/month)
- **Privacy-friendly** — no visual puzzle, runs in background
- **Requires Cloudflare account** and network call per verification (~50-100ms)
- **Mutually exclusive** with hCaptcha — pick one, not both

## SDK support

All frontend SDKs (TypeScript, React, Vue) include built-in Turnstile widget components. The `captchaToken` is passed automatically when using `useFaucetClaim` hooks.
