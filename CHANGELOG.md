# Changelog

All notable changes to this project will be documented in this file.

This project uses [changesets](https://github.com/changesets/changesets) for
versioning. Run `pnpm changeset` to add entries, then `pnpm changeset version`
(invoked by the release workflow) to regenerate this file.

## 1.1.2 (2026-04-17)

### Fixed
- **RPC signer driver now auto-imports and unlocks the faucet wallet
  on init.** Previously `NimiqRpcDriver.send()` called
  `sendBasicTransaction` against a node wallet manager that was never
  told about `FAUCET_PRIVATE_KEY` — every claim failed with
  `RPC sendBasicTransaction error: Internal error` (`RPC_-32603`)
  until the operator manually issued `importRawKey` + `unlockAccount`.
  `init()` now checks `listAccounts`, calls `importRawKey` when
  `FAUCET_PRIVATE_KEY` is supplied and the wallet isn't already known,
  and calls `unlockAccount` idempotently. Surfaces clean
  `WALLET_NOT_IMPORTED` / `WALLET_IMPORT_FAILED` /
  `WALLET_UNLOCK_FAILED` errors instead of the opaque `-32603` two
  layers deep in the claim path. Fixes
  [#38](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/38).

### Changed
- `NimiqRpcDriverConfig` gained an optional `privateKey` field. Plumbed
  through from `FAUCET_PRIVATE_KEY` via
  [apps/server/src/drivers.ts](apps/server/src/drivers.ts).
- [deploy/compose/README.md](deploy/compose/README.md) Option B (local
  node) documents the new auto-import behaviour — no more manual
  `curl importRawKey` / `unlockAccount` step.
- ROADMAP gained §1.1.2d (sign RPC tx locally, no key at the node —
  long-term follow-up) and §1.1.2e (full-claim CI smoke —
  complements the `compose-smoke` boot check from 1.1.1).
- Helm chart `1.1.2` / `appVersion: 1.1.2`; Flutter SDK `1.1.2`.

### Behaviour-preserving for externally-managed wallets
- Operators who pre-import + pre-unlock the wallet outside the faucet
  (and set only `FAUCET_WALLET_ADDRESS` + `FAUCET_WALLET_PASSPHRASE`
  with no `FAUCET_PRIVATE_KEY`) still work: `init()` skips
  `importRawKey` when `listAccounts` shows the address present, and
  `unlockAccount` is idempotent.
- Operators with no passphrase configured at all (assumed externally
  unlocked) see no change — wallet ops are skipped entirely.

## 1.1.1 (2026-04-17)

### Fixed
- **Compose Quick Start boots cleanly.** `deploy/compose/.env.example`
  now includes `FAUCET_DEV=1` with a comment — local-trial mode that
  relaxes hardening (allows plain HTTP + wildcard CORS) so the stack
  works against http://localhost:8080. Without this the container
  crashed on first boot with the hardening check at
  [apps/server/src/hardening.ts:137-145](apps/server/src/hardening.ts#L137-L145).
  Fixes [#39](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/39).

### Added
- CI `compose-smoke` job that boots the compose faucet service from the
  local-trial `.env.example` and asserts `/healthz` returns 200. Would
  have caught #39 pre-release.
- `docker-compose.yml` now explicitly threads
  `FAUCET_DEV: ${FAUCET_DEV:-0}` on the faucet service environment, so
  `.env` is the single place to flip it on (default stays `0` — a raw
  `docker-compose.yml` still boots in production-hardening mode).

### Changed
- Helm chart bumped to `1.1.1` / `appVersion: 1.1.1`.
- Flutter SDK bumped to `1.1.1`.

## 1.1.0 (2026-04-17)

### Added
- **`/readyz` endpoint.** `/healthz` stays pure liveness; `/readyz`
  reflects whether the signer driver is ready (for WASM: consensus
  established; for RPC: always ready). Probes, Helm, and the admin
  dashboard can now distinguish "process alive, driver syncing"
  from "process dead". Returns `200 {ready:true}` or
  `503 {ready:false, reason:"driver_not_ready"}` with `Retry-After: 10`.
- **`CurrencyDriver.readyPromise` + `isReady()`** — optional members on
  the `@faucet/core` driver interface. The server uses them to gate
  driver-dependent routes without blocking startup.
- **`DriverReadinessBanner`** in the admin dashboard — surfaces
  "Signer driver syncing" while `/readyz` returns 503, so operators
  can see the state instead of getting a connection-refused error
  or a confusing 503 from the claims table.
- **`START.md`** — `Choose your adventure` menu extracted from README
  so the README reads cleanly and the menu lives in one canonical
  place. README now points AI agents at `START.md` verbatim.

### Changed
- **Fastify now listens immediately at boot, regardless of driver
  state.** Driver-dependent routes (`POST /v1/claim`, admin account /
  overview / send) return `503 Retry-After: 10` until the driver
  signals ready; every other route (`/healthz`, `/readyz`,
  `/admin/*`, `/v1/config`, `/v1/challenge`, UIs) serves from t=0.
  Before 1.1, the WASM driver blocked `buildApp()` until consensus,
  rendering `/admin` and `/healthz` unreachable for the entire sync
  window (or forever if consensus never established). Fixes
  [#36](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/36).
- Helm chart bumped to `1.1.0` / `appVersion: 1.1.0`.
- Flutter SDK bumped to `1.1.0`.
- ROADMAP §1.1.2 marked as shipped; new §1.1.2a (dependency-chain
  `/readyz`), §1.1.2b (Helm probes migration), and §1.1.2c
  (upstream `@nimiq/core` refresh, tracking #35) added.

### Known
- The bundled WASM light client cannot reach TestAlbatross consensus
  against `@nimiq/core@2.2.2` — upstream-blocked. Tracked in
  [#35](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/35)
  and ROADMAP §1.1.2c. Use the RPC signer driver against a local
  `core-rs-albatross` node (`docker compose --profile local-node up -d`)
  for a working end-to-end setup.

## 1.0.2 (2026-04-17)

### Fixed
- **Quick Start now boots.** The README `docker run` block was missing
  `FAUCET_SIGNER_DRIVER=wasm` + `FAUCET_PRIVATE_KEY`; the default signer
  is `rpc`, which needs `FAUCET_RPC_URL` + `FAUCET_WALLET_ADDRESS`, so
  the literal copy-paste crashed at startup for 100% of users. Quick
  Start now recommends `docker compose --profile local-node up -d`
  (works end-to-end today); the image-only `docker run` path is kept
  as a smoke-test with honest caveats pointing at #35 and #36. Fixes
  [#37](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/37).

### Changed
- `deploy/compose/.env.example` default `FAUCET_SIGNER_DRIVER` flipped
  from `wasm` (upstream-blocked — see #35) to `rpc`, matching the
  compose README's Option A/B walkthrough.
- `AGENTS.md` quests **[1] Quick demo** and **[2] Docker container
  trial** now point at the compose path instead of a never-worked
  `docker run` shape.
- Helm chart bumped to `1.0.2` / `appVersion: 1.0.2`.
- Flutter SDK bumped to `1.0.2`.

## 1.0.1 (2026-04-17)

### Fixed
- **Published Docker image now starts.** `better-sqlite3`'s native
  binding is produced in the prune stage before being copied to the
  runtime, fixing a startup crash that affected 100% of "Quick start"
  users. Fixes [#33](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/33).
- **Compose stack no longer advertises an unsupported Postgres backend
  by default.** `DATABASE_URL` is unset; the server falls back to
  SQLite at `/data/faucet.db`. The `postgres` and `redis` services are
  kept in docker-compose.yml behind a new `postgres` profile for when
  server-side support lands (tracked in ROADMAP §1.3.4). Fixes
  [#34](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/34).

### Changed
- Clearer error message when a Postgres `DATABASE_URL` is supplied
  today — points at ROADMAP and the SQLite default path.
- Helm chart values.yaml and examples/values-prod.yaml document
  `postgresql.enabled=true` / `redis.enabled=true` as **not yet
  functional** on 1.0.x; defaults remain `enabled: false`.
- Helm chart bumped to `1.0.1` / `appVersion: 1.0.1`.
- Flutter SDK bumped to `1.0.1`.

### Added
- CI smoke-test step that boots the just-built Docker image and asserts
  `/healthz` returns 200 — would have caught #33 pre-release.
- ROADMAP §1.3.4 "Server-side Postgres storage backend" with concrete
  scope and an estimated effort.

## 1.0.0 (2026-04-16)

Initial public release. Everything below is new.

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
