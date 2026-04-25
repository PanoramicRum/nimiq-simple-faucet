# React Mini App — Faucet Claim

The React 18 + Vite counterpart to [`mini-app-claim-vue/`](../mini-app-claim-vue/). Same UX, same flow, same fcaptcha gate. Reuses the framework-agnostic glue in [`mini-app-claim-shared/`](../mini-app-claim-shared/).

## Run it (Docker, identical to the Vue example except port `5174`)

```bash
pnpm generate:wallet            # then fund it from https://faucet.pos.nimiq-testnet.com
export LAN_IP=$(hostname -I | awk '{print $1}')      # Linux
# export LAN_IP=$(ipconfig getifaddr en0)            # macOS
export FCAPTCHA_SECRET=demo-secret-change-me
export FAUCET_FCAPTCHA_SITE_KEY=demo-site-key
export FAUCET_FCAPTCHA_SECRET=demo-secret-change-me

cd examples/mini-app-claim-react
docker compose up --build
```

Then open `http://<LAN_IP>:5174` inside Nimiq Pay → Mini Apps on a phone on the same Wi-Fi.

See [`../mini-app-claim-vue/README.md`](../mini-app-claim-vue/README.md) for the full breakdown of what the compose file does, why TLS is off in dev, and how to verify with the [`mini-apps-checklist`](https://github.com/nimiq/developer-center/pull/175) skill.

## Layout differences from the Vue example

```
mini-app-claim-react/src/
├── main.tsx                   # createRoot + StrictMode
├── App.tsx
├── components/FcaptchaWidget.tsx
├── hooks/useMiniAppFaucet.ts  # React-state version of the Vue composable
├── styles.css                 # identical
└── env.d.ts
```

The Mini App SDK bridge, fcaptcha loader, and i18n strings come from `@nimiq-faucet/mini-app-claim-shared` — both examples consume the same source.
