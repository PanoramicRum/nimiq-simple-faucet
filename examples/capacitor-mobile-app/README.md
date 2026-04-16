# Capacitor Mobile App Example

Vite + React + Capacitor app demonstrating `@nimiq-faucet/capacitor` integration. In Docker, this runs as a web preview. For real mobile, add native platforms on the host.

## What this demonstrates

- `CapacitorFaucetClient` which auto-injects device fingerprint on native
- `useFaucetClaim` hook from `@nimiq-faucet/react` for claim lifecycle
- Graceful fallback in web mode (no device fingerprint, but claim still works)
- Address input, claim submission, and live status updates

## Run locally (web preview)

```bash
# From repo root
pnpm install
VITE_FAUCET_URL=http://localhost:8080 pnpm --filter @nimiq-faucet/example-capacitor dev
```

## Run with Docker (web preview)

```bash
# From repo root
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up --build example-capacitor
# Open http://localhost:3003
```

## For real mobile

```bash
cd examples/capacitor-mobile-app
npx cap add ios      # or android
npx cap open ios     # opens Xcode
```
