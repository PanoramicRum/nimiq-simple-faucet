# @faucet/server

Fastify API server for the Nimiq Simple Faucet. Handles claim processing,
abuse prevention, admin management, and serves both the public claim UI and
admin dashboard as static bundles.

## Scripts

```
pnpm -F @faucet/server dev          # tsx watch — hot-reload dev server on :8080
pnpm -F @faucet/server build        # tsc → dist/
pnpm -F @faucet/server start        # node dist/index.js (production)
pnpm -F @faucet/server test         # vitest run (53 tests)
pnpm -F @faucet/server typecheck    # tsc --noEmit
```

## Running locally

```bash
FAUCET_DEV=1 FAUCET_ADMIN_PASSWORD=dev pnpm -F @faucet/server dev
```

Open http://localhost:8080/ for the claim UI, http://localhost:8080/admin for
the dashboard (first login triggers TOTP enrolment).

Set `FAUCET_SIGNER_DRIVER=rpc` and `FAUCET_RPC_URL=...` to point at a Nimiq
Albatross testnet node for real transactions, or leave defaults for stub mode.

See the root `.env.example` for every env var.

## Architecture

```
src/
  index.ts              Entry point — builds app, listens on :8080
  app.ts                Fastify app factory (plugins, routes, static serving)
  config.ts             Zod-validated env config
  context.ts            AppContext shared across routes (db, driver, pipeline, config)
  db/
    schema.ts           Drizzle schema (claims, blocklist, integrators, audit_log, ...)
    migrate.ts          Auto-migration on startup
  routes/
    claim.ts            POST /v1/claim, GET /v1/claim/:id
    challenge.ts        POST /v1/challenge (hashcash)
    config.ts           GET /v1/config
    stats.ts            GET /v1/stats
    stream.ts           WS /v1/stream (live events)
    admin/*.ts          /admin/* routes (auth, claims, blocklist, integrators, config, account, audit)
  abuse/
    pipeline.ts         Orchestrates all 9 abuse checks into allow/challenge/review/deny
  auth/
    session.ts          Cookie sessions + TOTP
    keyring.ts          Faucet key encryption at rest (Argon2id + XChaCha20-Poly1305)
    hmac.ts             Integrator HMAC verification
  hardening.ts          Helmet, CSRF, rate limits, payload limits, error sanitisation
  mcp/
    server.ts           MCP tools + resources at /mcp
  openapi/
    schemas.ts          Zod schemas for OpenAPI generation
    document.ts         OpenAPI 3.1 document builder
    route.ts            GET /openapi.json, /openapi.yaml, /docs/api
```

## Key design decisions

- **Abuse pipeline** runs all enabled checks in parallel, collects signals, and
  returns a single `allow | challenge | review | deny` decision with a score
  and top contributing signals.
- **CurrencyDriver interface** (`@faucet/core`) keeps coin-specific logic out
  of the server — Nimiq lives in `driver-nimiq-rpc` / `driver-nimiq-wasm`.
- **Static UI serving** via `@fastify/static`: claim UI at `/`, dashboard at
  `/admin/`. SPA fallback returns `index.html` for client-side routing.
- **Security**: no stack traces in prod, timing-safe comparisons, HttpOnly
  session cookies, CSRF double-submit, per-endpoint rate limits.
