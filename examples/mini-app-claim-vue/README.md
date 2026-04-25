# Vue Mini App — Faucet Claim

A [Nimiq Pay Mini App](https://mini-apps-launch-developer-center-dev-worker.je-cf9.workers.dev/mini-apps) (Vue 3 + Vite) that claims testnet NIM from a self-hosted [`nimiq-simple-faucet`](../../README.md). Pairs with [`mini-app-claim-react/`](../mini-app-claim-react/) — both share the framework-agnostic [`mini-app-claim-shared/`](../mini-app-claim-shared/) glue.

## What this example demonstrates

- Reading the user's NIM address from inside Nimiq Pay via [`@nimiq/mini-app-sdk`](https://www.npmjs.com/package/@nimiq/mini-app-sdk) (`init()` → `provider.listAccounts()`).
- Submitting a claim through the faucet's existing public `POST /v1/claim` endpoint via [`@nimiq-faucet/sdk`](../../packages/sdk-ts/) — no integrator HMAC, no custom auth.
- Solving an [fcaptcha](https://github.com/WebDecoy/FCaptcha) challenge inside a WebView with no third-party iframes.
- Showing live broadcast → confirmation status using the SDK's `waitForConfirmation` helper.
- Mobile-first layout: 375px minimum viewport, 44px+ touch targets, dark-mode aware, safe-area insets respected. Validated against [`mini-apps-checklist`](https://github.com/nimiq/developer-center/pull/175).

## Run it (everything in Docker)

```bash
# 1. From the repo root, pre-fund the faucet's testnet wallet:
pnpm generate:wallet            # prints a NIM testnet address
# Send testnet NIM to that address from https://faucet.pos.nimiq-testnet.com

# 2. Set your dev machine's Wi-Fi IP and demo secrets:
export LAN_IP=$(hostname -I | awk '{print $1}')      # Linux
# export LAN_IP=$(ipconfig getifaddr en0)            # macOS
export FCAPTCHA_SECRET=demo-secret-change-me
export FAUCET_FCAPTCHA_SITE_KEY=demo-site-key
export FAUCET_FCAPTCHA_SECRET=demo-secret-change-me

# 3. Bring up faucet + fcaptcha + this mini app:
cd examples/mini-app-claim-vue
docker compose up --build
```

Wait for `vite ready at http://<LAN_IP>:5173` and `faucet listening on 0.0.0.0:8080`.

## Open it on a real phone

1. Make sure the phone is on the same Wi-Fi as your dev machine.
2. Open Nimiq Pay → **Mini Apps** → enter `http://<LAN_IP>:5173`.
3. Tap **Claim NIM** → approve the address-share dialog → solve fcaptcha → wait for `Confirmed`.

> **Need testnet mode in Nimiq Pay?** Long-press the settings button for ~10 seconds to reveal the dev menu, then switch the Nimiq provider to Testnet.

## What this compose file is doing

It uses Compose's `include:` to layer:

1. `deploy/compose/docker-compose.yml` — base faucet (Fastify + SQLite + WASM signer, testnet).
2. `deploy/compose/fcaptcha.yml` — `webdecoy/fcaptcha` on port 3000.
3. This file — Vite dev server on port 5173 with `--host` so the phone can reach it.

The compose file overrides the faucet env to:

| Env var | Value | Why |
|---|---|---|
| `FAUCET_DEV` | `1` | Allows non-TLS in dev. |
| `FAUCET_TLS_REQUIRED` | `false` | LAN HTTP. |
| `FAUCET_CORS_ORIGINS` | `*` | Phone WebView fetch. |
| `FAUCET_UI_ENABLED` | `false` | The mini app is the UI. |
| `FAUCET_RATE_LIMIT_PER_IP_PER_DAY` | `20` | Generous for testing. |

> ⚠️ **DO NOT** copy these settings into a production deployment. In production, set a real CORS allowlist (the Mini App's exact origin), keep TLS on, and tighten rate limits.

## Layout

```
mini-app-claim-vue/
├── docker-compose.yml          # this file (per-example, includes the backend)
├── Dockerfile                  # production build → nginx
├── Dockerfile.dev              # dev: vite --host
├── nginx.conf                  # production
├── index.html                  # mobile viewport, theme-color
├── vite.config.ts              # server.host: true, HMR over LAN
├── tsconfig.json
├── package.json
└── src/
    ├── main.ts
    ├── App.vue                 # state-machine UI
    ├── components/FcaptchaWidget.vue
    ├── composables/useMiniAppFaucet.ts
    ├── styles.css              # mobile-first tokens, dark mode, safe-area
    └── env.d.ts
```

The Mini App SDK ↔ Faucet SDK glue lives one directory up in [`mini-app-claim-shared/`](../mini-app-claim-shared/) — it'll be promoted to a published `@nimiq-faucet/mini-app` package once a third framework example exists.

## Verifying with the checklist skill

Before opening a PR with changes:

```bash
npx skills add nimiq/developer-center --skill mini-apps-checklist
```

…then ask Claude (or any compatible AI tool) to run the checklist against this directory. Target: zero `FAIL`s.
