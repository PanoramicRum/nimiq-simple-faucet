# Vue Claim Page Example

Minimal Vue 3 + Vite app demonstrating `@nimiq-faucet/vue` integration.

## What this demonstrates

- `FaucetClient` instantiation from `@nimiq-faucet/vue`
- `useFaucetClaim` composable for reactive claim state
- Address input, claim submission, and live status updates
- Error handling with retry

## Run locally

```bash
# From repo root
pnpm install
VITE_FAUCET_URL=http://localhost:8080 pnpm --filter @nimiq-faucet/example-vue dev
```

## Run with Docker

```bash
# From repo root — starts faucet + this example
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up --build example-vue
# Open http://localhost:3002
```

## Project structure

```
vue-claim-page/
  src/
    App.vue        — claim UI component
    main.ts        — app entry
    env.d.ts       — Vite env types
  index.html       — Vite HTML entry
  package.json
  vite.config.ts
  tsconfig.json
  Dockerfile
  nginx.conf
```
