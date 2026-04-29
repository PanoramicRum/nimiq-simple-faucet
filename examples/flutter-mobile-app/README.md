# Flutter / Dart SDK Demo

CLI app demonstrating the `nimiq_faucet` Dart SDK **with full abuse-layer support**: HMAC-signed `hostContext` and automatic hashcash via `solveAndClaim()`.

Runs as a compiled binary in Docker.

## What this demonstrates

- `FaucetClient` instantiation
- `config()` to fetch faucet configuration (captcha provider, hashcash difficulty)
- **`signHostContext(...)` — HMAC-signed user-state assertions** (load-bearing in the faucet's abuse pipeline)
- **`solveAndClaim(...)` — automatic hashcash challenge round-trip** (works whether or not the server requires PoW)
- `waitForConfirmation()` polling
- Error handling via `FaucetException`

## Configuration

| Env var                       | Required | Default                         | Notes |
|-------------------------------|----------|---------------------------------|-------|
| `FAUCET_URL`                  | no       | `http://localhost:8080`         | Faucet base URL |
| `FAUCET_INTEGRATOR_ID`        | no       | `dart-cli-example`              | Identifier embedded in `hostContext.uid` and HMAC signature prefix |
| `FAUCET_HMAC_SECRET`          | **prod** | unset                           | Server-only HMAC secret. With it set, the demo signs hostContext. Without it the asserted fields aren't load-bearing. |
| `CLAIM_ADDRESS`               | no       | placeholder                     | Recipient address (also accepted as positional CLI arg) |
| `CLAIM_USER_ID`               | no       | `FAUCET_INTEGRATOR_ID`          | uid attached to hostContext |
| `CLAIM_KYC_LEVEL`             | no       | unset                           | `none` / `email` / `phone` / `id` |
| `CLAIM_ACCOUNT_AGE_DAYS`      | no       | unset                           | integer; only meaningful when signed |

## Run locally

```bash
cd examples/flutter-mobile-app
dart pub get
FAUCET_URL=http://localhost:8080 \
  FAUCET_HMAC_SECRET="$(openssl rand -hex 32)" \
  CLAIM_KYC_LEVEL=email CLAIM_ACCOUNT_AGE_DAYS=180 \
  dart run bin/main.dart "NQ00 0000 0000 0000 0000 0000 0000 0000 0000"
```

## Run with Docker

```bash
# From repo root — starts faucet + runs this demo
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up --build example-flutter
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml logs example-flutter
```

## Abuse layers

| Layer | How this example demonstrates it |
|-------|----------------------------------|
| **Hashcash** | `client.solveAndClaim(...)` calls `requestChallenge()` → solves the SHA-256 PoW → posts the solution. On servers without hashcash configured, this is identical to a plain `claim()`. |
| **`hostContext` (HMAC-signed)** | `signHostContext(ctx, integratorId, hmacSecret)` — the faucet verifies the HMAC and treats `uid`, `kycLevel`, `accountAgeDays`, `tags` as load-bearing. **Without a signature, asserted fields are ignored.** |
| **Captcha** | Not applicable to a CLI — captcha tokens come from a user's browser/device. A Flutter mobile app would render the widget in a `WebView` and forward the token via `ClaimOptions.captchaToken`. |
| **Fingerprint** | A Flutter mobile app can capture device info via `device_info_plus` and pass it via `ClaimOptions.fingerprint` (out of scope for this CLI demo). |

## For a real Flutter mobile app

This example is a Dart CLI to prove the SDK works in Docker. For a real Flutter app:

1. `flutter create my_app && cd my_app`
2. Add `nimiq_faucet` to `pubspec.yaml`
3. Use `FaucetClient` in your widgets (see `packages/sdk-flutter/example/main.dart`)
4. For abuse-layer integration:
   - **hostContext signing happens on YOUR backend**, not in the app — the app receives a pre-signed context as part of authenticated session state
   - **Captcha** — render in a `WebView` widget, intercept the token callback
   - **Fingerprint** — `device_info_plus` for stable device IDs; pass to `FaucetClient.claim()` via `ClaimOptions.fingerprint`
