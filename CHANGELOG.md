# Changelog

All notable changes to this project will be documented in this file.

This project uses [changesets](https://github.com/changesets/changesets) for
versioning. Run `pnpm changeset` to add entries, then `pnpm changeset version`
(invoked by the release workflow) to regenerate this file.

## 0.0.1 (unreleased)

Initial pre-release. Everything below is new.

### Server
- Fastify API with `POST /v1/claim`, `GET /v1/claim/:id`, `POST /v1/challenge`, `GET /v1/config`, `GET /v1/stats`, `WS /v1/stream`, `GET /healthz`
- Admin API: auth (password + TOTP), claims management, blocklist, integrator keys, live config, audit log
- 9 abuse-prevention layers: blocklist, rate-limit, Turnstile, hCaptcha, hashcash, geo-IP, fingerprint, on-chain heuristics, AI scoring
- Pluggable currency drivers: `driver-nimiq-rpc` (JSON-RPC) and `driver-nimiq-wasm` (in-process)
- Key encryption at rest (Argon2id + XChaCha20-Poly1305)
- MCP server at `/mcp` with public and admin tools
- OpenAPI 3.1 spec served at `/openapi.json`

### Client SDKs
- `@nimiq-faucet/sdk` — framework-agnostic TypeScript client
- `@nimiq-faucet/react` — React hooks (`useFaucetClaim`, `useFaucetStatus`, `useFaucetStream`)
- `@nimiq-faucet/vue` — Vue 3 composables (same surface as React)
- `@nimiq-faucet/capacitor` — Capacitor plugin with auto device fingerprint
- `@nimiq-faucet/react-native` — React Native wrapper with device-info integration
- `nimiq_faucet` — Dart/Flutter SDK
- `github.com/PanoramicRum/nimiq-simple-faucet/packages/sdk-go` — Go SDK

### UI
- Public claim page (`apps/claim-ui`) — Vue 3 + Vite, address validation, captcha/hashcash, live status via WebSocket
- Admin dashboard (`apps/dashboard`) — Vue 3 + Vite, login/TOTP, claims table with explain drawer, abuse editor, audit log

### Deploy
- Single Docker image (SQLite default) with both UIs baked in
- Docker Compose stack (Postgres + Redis + optional local Nimiq node)
- Helm chart for Kubernetes

### AI discoverability
- `AGENTS.md` with per-framework integration recipes
- `llms.txt` / `llms-full.txt` served at well-known URLs
- Per-package `llms.txt` files
