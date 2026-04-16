# Next.js Claim Page Example

Minimal Next.js 14 app demonstrating `@nimiq-faucet/react` integration.

## What this demonstrates

- `FaucetClient` instantiation from `@nimiq-faucet/react`
- `useFaucetClaim` hook for claim lifecycle management
- Address input, claim submission, and live status updates
- Error handling with retry

## Run locally

```bash
# From repo root
pnpm install
NEXT_PUBLIC_FAUCET_URL=http://localhost:8080 pnpm --filter @nimiq-faucet/example-nextjs dev
```

## Run with Docker

```bash
# From repo root — starts faucet + this example
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up --build example-nextjs
# Open http://localhost:3001
```

## Project structure

```
nextjs-claim-page/
  app/
    layout.tsx     — root layout
    page.tsx       — claim UI (client component)
    globals.css    — styles
  package.json
  next.config.mjs
  tsconfig.json
  Dockerfile
```
