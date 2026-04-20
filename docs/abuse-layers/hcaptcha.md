# hCaptcha

Human verification challenge powered by the hCaptcha service. Presents a visual or invisible challenge to verify the user is human before allowing a claim.

## How it works

1. The ClaimUI loads the hCaptcha widget using the public site key
2. The user completes the challenge (visual puzzle or invisible, depending on configuration)
3. The client includes the resulting token in the claim request as `captchaToken`
4. The server verifies the token against `hcaptcha.com/siteverify`
5. If verification passes, the claim proceeds; if it fails, the claim is denied

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `FAUCET_HCAPTCHA_SITE_KEY` | _(unset = disabled)_ | Public site key from hCaptcha dashboard |
| `FAUCET_HCAPTCHA_SECRET` | _(unset)_ | Server-side secret for verification |

Setting `FAUCET_HCAPTCHA_SITE_KEY` enables the layer. Both the site key and secret are required.

### Getting credentials

1. Sign up at [hCaptcha Dashboard](https://dashboard.hcaptcha.com/)
2. Create a site and choose the challenge difficulty
3. Copy the site key and secret key

## Decision logic

- **No token provided:** `deny` with reason "captcha token required"
- **Token verification fails or token reused:** `deny`
- **Token valid:** `allow` with score 0

## Trade-offs

- **Free tier** available for most use cases
- **Privacy-focused** alternative to reCAPTCHA
- **Requires network call** per verification (~100-200ms)
- **Mutually exclusive** with Turnstile — pick one, not both

## SDK support

All frontend SDKs include built-in hCaptcha widget components. The `captchaToken` is passed automatically when using `useFaucetClaim` hooks.
