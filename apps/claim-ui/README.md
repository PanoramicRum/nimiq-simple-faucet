# @nimiq-faucet/claim-ui

Public claim page for the Nimiq faucet. Vue 3 + Vite + TypeScript + Tailwind v3.

## Develop

The Fastify server must be running on `http://localhost:8080` (Vite proxies
`/v1/*` and `/ws/v1/stream` to it):

```sh
pnpm --filter @nimiq-faucet/claim-ui dev
```

Open `http://localhost:5173`.

## Build

```sh
pnpm --filter @nimiq-faucet/claim-ui build
```

Emits `dist/`, which Fastify serves at `/` in M4.4.

## Typecheck

```sh
pnpm --filter @nimiq-faucet/claim-ui typecheck
```
