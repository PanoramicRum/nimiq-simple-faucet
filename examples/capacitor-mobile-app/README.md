# Capacitor Mobile App Example

Vite + React + Capacitor app demonstrating `@nimiq-faucet/capacitor` integration **with full abuse-layer support**: device fingerprint (auto-injected), captcha widget, hashcash, and `hostContext`.

In Docker this runs as a web preview. For real iOS/Android, add native platforms on the host.

## What this demonstrates

- `CapacitorFaucetClient` — auto-injects `fingerprint.visitorId` from `@capacitor/device`'s `Device.getId()` on every claim
- Device info surfacing in the UI (platform, model, visitorId) so testers can see what the faucet receives
- `/v1/config` discovery — captcha + hashcash rendered conditionally
- Cloudflare Turnstile + hCaptcha widget integration in the WebView
- Hashcash via `client.solveAndClaim()` (works whether or not the server requires PoW)
- `hostContext` shape (uid + signed-context pattern documented in code comments)

## Run locally (web preview)

```bash
# From repo root
pnpm install
cp examples/capacitor-mobile-app/.env.example examples/capacitor-mobile-app/.env
pnpm --filter @nimiq-faucet/example-capacitor dev
```

## Run with Docker (web preview)

```bash
# From repo root
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up --build example-capacitor
# Open http://localhost:3003
```

## Configuration

| Env var                    | Default                       | Notes |
|----------------------------|-------------------------------|-------|
| `VITE_FAUCET_URL`          | `http://localhost:8080`       | Faucet base URL the WebView hits |
| `VITE_INTEGRATOR_ID`       | `capacitor-example`           | Identifier embedded in `hostContext.uid` |

## For real mobile

```bash
cd examples/capacitor-mobile-app
npx cap add ios      # or android
npx cap open ios     # opens Xcode
```

On native iOS/Android the `@capacitor/device` `Device.getId()` returns:
- **iOS**: a vendor-stable UUID (`identifierForVendor`)
- **Android 8+**: a 64-bit hex string keyed by `(app-signing-key, user, device)`
- **Web**: a per-browser localStorage UUID (regenerated if storage is cleared)

The faucet receives this as `fingerprint.visitorId` and uses it in the abuse pipeline (e.g. fingerprint-velocity layer).

## Abuse layers

| Layer | How this example demonstrates it |
|-------|----------------------------------|
| **Device fingerprint** | `CapacitorFaucetClient` auto-populates `fingerprint.visitorId` from `Device.getId()`. The UI surfaces the value so you can verify what the faucet sees. |
| **Cloudflare Turnstile / hCaptcha** | Loaded from `/v1/config.captcha.provider`. Widget renders in the WebView; token sent on `claim` as `captchaToken`. |
| **Hashcash** | `client.solveAndClaim()` calls `requestChallenge()` → `solveHashcash()` → `claim()` with the solution. On servers without hashcash configured this is identical to a plain `claim()`. |
| **`hostContext` (signed)** | Production mobile apps receive a backend-signed context as part of authenticated session state — the device should NEVER hold the HMAC secret. The demo sends a plain uid for runnability. |
| **GeoIP / On-chain / AI** | Server-side only — invisible to the app. |

Server-side details: [`docs/abuse-prevention.md`](../../docs/abuse-prevention.md).
