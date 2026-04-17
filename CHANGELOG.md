# Changelog

All notable changes to this project will be documented in this file.

This project uses [changesets](https://github.com/changesets/changesets) for
versioning. Run `pnpm changeset` to add entries, then `pnpm changeset version`
(invoked by the release workflow) to regenerate this file.

## 2.0.0 (2026-04-17)

### Added
- **Per-field integrator-signed host context.** Browser SDKs can now
  submit a pre-signed `hostContext.signature` (format:
  `{integratorId}:{base64-hmac}`) without the integrator's backend
  proxying the whole claim request. The server verifies the HMAC
  against the integrator's secret and sets `hostContextVerified: true`.
  The whole-request HMAC flow continues to work alongside.
  (ROADMAP §1.4)
- **`verifiedIdentities` field on HostContext.** Array of SSO providers
  the integrator authenticated the user against (e.g., `["apple",
  "google"]`). Covered by the per-field signature. Claims with verified
  identities receive a scoring bonus (lower abuse score, -0.15
  contribution from the AI layer).
- **`FaucetClient.signHostContext()` static method.** Backend-only
  helper: takes a hostContext + integrator ID + HMAC secret → returns
  the context with `signature` populated. Pass the result through to
  the browser SDK's `claim()` call.

### Changed
- README abuse layer list expanded from 6 grouped items to 9 individual
  layers (blocklist, rate-limit, Turnstile, hCaptcha, hashcash,
  geo-IP, fingerprint, on-chain, AI).
- HostContext canonicalization now includes `verifiedIdentities`.
- OpenAPI spec updated: `HostContext.verifiedIdentities` + signature
  format documented.
- Helm chart bumped to `2.0.0` / `appVersion: 2.0.0`.
- Flutter SDK bumped to `2.0.0`.

## 1.9.0 (2026-04-17)

### Changed
- **Dependency sweep: 6 major-version upgrades.**
  - `@noble/hashes` 1→2 (crypto primitives)
  - `maxmind` 4→5 (GeoIP MMDB reader)
  - `@fastify/helmet` 12→13 (security headers)
  - `pinia` 2→3 (Vue store, dashboard)
  - `@types/node` 22→25 (TypeScript types)
  - `@vitejs/plugin-vue` 5→6 (Vue Vite plugin)
- **Deferred to next Vite upgrade cycle:** `tailwindcss` 3→4 (requires
  PostCSS plugin split + CSS-first config migration) and
  `@vitejs/plugin-react` 4→6 (requires Vite 6+).
- Helm chart bumped to `1.9.0` / `appVersion: 1.9.0`.
- Flutter SDK bumped to `1.9.0`.

## 1.8.3 (2026-04-17)

### Changed
- **React/Vue SDK hooks share a common engine.** The claim lifecycle,
  confirmation polling, and stream subscription logic now live in
  `@nimiq-faucet/sdk` as imperative state machines (`ClaimManager`,
  `StatusPoller`, `StreamManager`). The React and Vue SDKs are thin
  reactive wrappers (~15 lines each vs ~55 previously). Zero API
  changes for consumers. Fixes
  [#60](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/60).
- Helm chart bumped to `1.8.3` / `appVersion: 1.8.3`.
- Flutter SDK bumped to `1.8.3`.

## 1.8.2 (2026-04-17)

### Changed
- **SQLite/Postgres migrations deduplicated.** The ~200 lines of
  near-identical CREATE TABLE statements are replaced by a shared
  `migrationStatements(dialect)` builder in `db/migrations.ts` that
  parameterizes timestamp types (`INTEGER` vs `BIGINT`) and default
  expressions. Drizzle schema files stay separate (type-system
  constraint) but a new 11-test schema-parity suite asserts
  column-name alignment between the two — catches drift where a column
  is added to one dialect but not the other. Fixes
  [#59](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/59).
- Helm chart bumped to `1.8.2` / `appVersion: 1.8.2`.
- Flutter SDK bumped to `1.8.2`.

## 1.8.1 (2026-04-17)

### Changed
- **Config response derivation centralized in `configView.ts`.** The
  abuse-layer toggle list (7 layers), public `/v1/config` response,
  and admin `/admin/config` base object are now derived from shared
  helper functions instead of being hand-mapped independently in each
  route handler. Prevents layer-name drift and field-mapping
  inconsistencies. Fixes
  [#58](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/58).
- Helm chart bumped to `1.8.1` / `appVersion: 1.8.1`.
- Flutter SDK bumped to `1.8.1`.

## 1.8.0 (2026-04-17)

### Changed
- **Route schemas are now single-source.** All 10 inline Zod validators
  that were duplicated across route handler files now import from
  `openapi/schemas.ts` — the same schemas that generate the OpenAPI
  spec. Eliminates the dual-maintenance pattern where route validators
  and OpenAPI documentation could drift independently. Zero inline
  `z.object()` definitions remain in `apps/server/src/routes/`. Fixes
  [#57](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/57).
- 3 previously-undocumented query schemas (`BlocklistListQuery`,
  `ClaimsListQuery`, `AuditListQuery`) now appear in the OpenAPI spec.
- `ClaimRequest` OpenAPI schema updated to include `idempotencyKey`
  (added in v1.7.0 but missing from spec).
- `ClaimResponse` status enum updated to include `timeout` and `expired`
  (added in v1.7.0 but missing from spec).
- Frozen OpenAPI spec regenerated.
- Helm chart bumped to `1.8.0` / `appVersion: 1.8.0`.
- Flutter SDK bumped to `1.8.0`.

## 1.7.0 (2026-04-17)

### Added
- **Richer claim status transitions.** Claims can now be `timeout`
  (confirmation polling exhausted, reconciler will retry) or `expired`
  (TX invalidated on-chain, funds never left). The admin dashboard
  gains color-coded status badges (green=confirmed, yellow=broadcast,
  gray=timeout, red=rejected/expired, orange=challenged). SDK callers
  and the `/v1/claim/:id` endpoint return the richer status.
  (ROADMAP §1.3.2)
- **Claim idempotency via `idempotencyKey`.** Integrators can supply an
  optional key (string, max 128 chars) with each claim request.
  Duplicate requests within the key's lifetime return the original
  result (same claim ID, same status, `idempotent: true`) without
  re-running the abuse pipeline or sending a second transaction.
  Unique partial index on `claims.idempotency_key`. (ROADMAP §1.3.3)

### Changed
- Reconciler now sweeps claims with status `broadcast` OR `timeout`
  (timeout claims are retryable). On-chain expiry writes `expired`
  (distinct from abuse-pipeline `rejected`).
- `POST /v1/claim` accepts optional `idempotencyKey` field.
- `claims` table gains `idempotency_key` column (nullable, unique
  partial index). Migration adds the column automatically on upgrade.
- Helm chart bumped to `1.7.0` / `appVersion: 1.7.0`.
- Flutter SDK bumped to `1.7.0`.

## 1.6.0 (2026-04-17)

### Security
- **Per-IP rate limit no longer bypassable via concurrent requests.**
  Counter increments at the start of the claim handler (before the
  abuse pipeline), not after. Rejected/challenged claims decrement.
  Closes the TOCTOU window where all concurrent requests saw count=0.
  Fixes [#52](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/52).
- **Login endpoint returns a single error for all failure modes.**
  "invalid credentials" for wrong password, missing TOTP, and invalid
  TOTP — no more authentication enumeration. Fixes
  [#55](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/55).
- **Source maps no longer served in production.** Vite builds with
  `sourcemap: false` when `NODE_ENV=production`. Local dev retains
  source maps. Fixes
  [#54](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/54).

### Fixed
- Concurrent integrator key rotation returns `409 Conflict` instead
  of silently overwriting. Optimistic locking via
  `WHERE api_key_hash = <old>`. Fixes
  [#53](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/53).
- Unused imports in `admin-cli.ts` and `reconcile.test.ts` (CodeQL
  alerts #315, #316).
- Test configs now explicitly set `geoipBackend: 'none'` to avoid
  unhandled rejections from the DB-IP MMDB resolver in test
  environments where the MMDB files aren't installed.

### Added
- **DB-IP Lite as zero-config default GeoIP backend.** Country + ASN
  lookup works out of the box — no MaxMind signup, no env vars.
  Default `FAUCET_GEOIP_BACKEND` changed from `none` to `dbip`.
  CC BY 4.0 attribution included in `/v1/config` response. (PR #56)

### Changed
- Helm chart bumped to `1.6.0` / `appVersion: 1.6.0`.
- Flutter SDK bumped to `1.6.0`.

## 1.5.1 (2026-04-17)

### Fixed
- **Docker image no longer crashes on startup.** v1.4.0 introduced the
  reconciler with `app.addHook('onClose', ...)` called AFTER
  `app.listen()` — Fastify 5 forbids this. Moved the hook registration
  before listen. The CI smoke-test ("container exited early") now
  catches this class of regression.

### Added
- **Grafana dashboard JSON** at `deploy/grafana/nimiq-faucet.json`.
  Import into any Grafana instance connected to the faucet's Prometheus
  — panels for claim rate, wallet balance, driver status, latency
  percentiles (p50/p95/p99), and reconciler activity. (ROADMAP §1.1.3)
- **`/readyz` now checks DB connectivity + wallet balance**, not just
  driver readiness. Returns a structured
  `{ ready, checks: { driver, db, balance } }` body so operators and
  load balancers can pinpoint which dependency is down.
  (ROADMAP §1.1.2a)

### Changed
- Helm chart bumped to `1.5.1` / `appVersion: 1.5.1`.
- Flutter SDK bumped to `1.5.1`.

## 1.5.0 (2026-04-17)

### Added
- **Postgres storage backend.** Set `DATABASE_URL=postgres://...` to
  use Postgres instead of SQLite. The server detects the URL scheme at
  startup and initialises the correct Drizzle dialect + schema
  automatically. Timestamps stored as `bigint` (epoch ms) on both
  backends for application-layer parity. SQLite remains the default
  when `DATABASE_URL` is unset. (ROADMAP §1.3.4)
- **Redis rate-limit store.** When `REDIS_URL` is set, `@fastify/rate-limit`
  uses a shared Redis store instead of in-memory counters. Enables
  consistent rate limiting across multiple replicas. (`ioredis` dep
  added.)
- **Postgres schema** at `apps/server/src/db/schema.pg.ts` — mirrors
  the SQLite schema with `pgTable` + Postgres-native column types.
- **Dual-dialect DB factory** — `openDb()` returns a typed Drizzle
  instance for either SQLite or Postgres based on `DATABASE_URL`.

### Changed
- **Compose `postgres` + `redis` profiles are now production-ready.**
  Comments updated to reflect that the server consumes them (since
  v1.5.0). `.env.example` documents `DATABASE_URL` + `REDIS_URL`.
- **Helm `examples/values-prod.yaml`** flipped to `postgresql.enabled:
  true`, `redis.enabled: true`, `replicaCount: 2`, `autoscaling:
  enabled: true`. Multi-replica deployments are supported.
- `pg` + `@types/pg` + `ioredis` added to server dependencies.
- Helm chart bumped to `1.5.0` / `appVersion: 1.5.0`.
- Flutter SDK bumped to `1.5.0`.

## 1.4.0 (2026-04-17)

### Added
- **Prometheus `/metrics` endpoint.** Exposes counters
  (`faucet_claims_total{status,decision}`), histograms
  (`faucet_claim_duration_seconds{phase}`), and gauges
  (`faucet_wallet_balance_luna`, `faucet_driver_ready`,
  `faucet_reconciler_flips_total{to}`) in standard Prometheus text
  format. Gated by `FAUCET_METRICS_ENABLED` (default true). Plugs into
  any Grafana / AlertManager stack without polling `/v1/stats`.
  (ROADMAP §1.1.1)
- **Background reconciliation for stuck `broadcast` claims.** A
  periodic sweep (default every 5 minutes) checks in-flight claims
  against the chain via `waitForConfirmation` and flips them to
  `confirmed` or `rejected`. Handles server restarts that orphan the
  in-memory confirmation promise. Gated by `FAUCET_RECONCILE_ENABLED`
  (default true), interval configurable via
  `FAUCET_RECONCILE_INTERVAL_MS`. (ROADMAP §1.3.1)

### Changed
- Helm chart bumped to `1.4.0` / `appVersion: 1.4.0`.
- Flutter SDK bumped to `1.4.0`.

## 1.3.0 (2026-04-17)

### Added
- **Admin TOTP reset CLI.** `docker exec <container> node
  apps/server/dist/admin-cli.js reset-totp` wipes the admin user's
  TOTP secret + sessions so the operator can re-enrol via the login
  page. No more manual SQLite surgery. (ROADMAP §1.1.4)
- Docker badge in README linking to the GHCR package page.
- `.github/FUNDING.yml` with a placeholder for GitHub Sponsors.
  (ROADMAP §1.2.4)

### Changed
- **Helm `readinessProbe` now uses `/readyz`** instead of `/healthz`.
  `livenessProbe` stays on `/healthz`. Kubernetes stops routing traffic
  to pods whose signer driver isn't ready, while still restarting pods
  that crash. (ROADMAP §1.1.2b)
- `docs/admin-first-run.md` "re-enrol TOTP" section updated from
  manual SQL to the new CLI.
- Helm chart bumped to `1.3.0` / `appVersion: 1.3.0`.
- Flutter SDK bumped to `1.3.0`.

## 1.2.4 (2026-04-17)

### Fixed
- **Rapid duplicate claims to the same address no longer produce two
  records with the same txId.** An in-memory per-address lock rejects
  concurrent `POST /v1/claim` while a `send()` for that address is in
  flight, returning `429 claim_in_progress`. Prevents accounting drift
  where the DB showed 2 fulfilled claims but only 1 on-chain tx. Fixes
  [#50](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/50).

### Added
- **Abuse-layer toggles take effect immediately on admin config Save.**
  The abuse pipeline is rebuilt in memory on `PATCH /admin/config` with
  the persisted overrides for fingerprint, on-chain, and AI layers.
  Other config values (claim amount, rate limit) still require a
  restart. Fixes
  [#51](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/51).

### Changed
- Admin Config UI: warning banner now distinguishes "layer toggles:
  immediate" from "other settings: restart required."
- Helm chart bumped to `1.2.4` / `appVersion: 1.2.4`.
- Flutter SDK bumped to `1.2.4`.

## 1.2.3 (2026-04-17)

### Security
- **TOCTOU race in keyring resolved.** `loadOrInitKeyring()` used
  `existsSync()` + `readFileSync()` — a file could change between the
  two calls. Now reads first, catches `ENOENT`, then creates if
  missing. Low-risk in single-process deployments but correct practice.

### Changed
- Resolved all 12 CodeQL code-scanning alerts: 4 code fixes (keyring
  TOCTOU, 2 useless variable assignments, 1 unused constant) + 8
  false-positive dismissals with documented reasons (SHA-256 on
  high-entropy API keys, Fastify rate-limit plugin not recognized,
  linear regex misidentified as polynomial, web-worker origin check
  not applicable, integrator API-key gate not a bypass, single-run
  CLI script race).
- Helm chart bumped to `1.2.3` / `appVersion: 1.2.3`.
- Flutter SDK bumped to `1.2.3`.

## 1.2.2 (2026-04-17)

### Fixed
- **`ip_counters` table uses composite PK `(ip, day)`.** Previously
  `ip TEXT PRIMARY KEY` caused `SQLITE_CONSTRAINT_PRIMARYKEY 500` for
  every returning IP after UTC midnight. The schema, raw SQL, and
  `incrementIpCounter()` are fixed with an atomic upsert; existing
  counters are dropped and recreated on upgrade (ephemeral rate-limit
  data). Fixes
  [#47](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/47).
- **Admin Config "Saved" toast now says "restart required"** and the
  restart-required note in the UI is styled as a visible warning banner
  with clear language. Fixes
  [#48](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/48)
  (UX portion; config hot-reload is planned for a future release).

### Added
- 6 missing routes in the OpenAPI spec:
  `GET /admin/claims/{id}/explain`,
  `DELETE /admin/blocklist/{id}`,
  `POST /admin/integrators/{id}/rotate`,
  `DELETE /admin/integrators/{id}`,
  `POST /admin/auth/totp/enroll`,
  `POST /admin/auth/reset`. Frozen spec regenerated. Fixes
  [#49](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/49).

### Changed
- Helm chart bumped to `1.2.2` / `appVersion: 1.2.2`.
- Flutter SDK bumped to `1.2.2`.

## 1.2.0 (2026-04-17)

### Added
- **RPC driver ongoing health probe.** `NimiqRpcDriver` now pings
  `getBlockNumber` every 5 seconds after init. `isReady()` flips false
  when the RPC node becomes unreachable and back to true when it
  recovers. `/readyz` reflects real-time RPC health; the admin
  `DriverReadinessBanner` appears/disappears; and the v1.1.0
  503-preHandler hook now gates claims when the node is actually down
  (previously `isReady()` was hardcoded `true` post-init). Fixes
  [#46](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/46).
- `pnpm smoke:testnet` now auto-builds dependencies via a `presmoke:testnet`
  hook — no more `ERR_MODULE_NOT_FOUND` on fresh checkouts. Fixes
  [#45](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/45).

### Fixed
- **Admin Account page Refresh button now disables during fetch** and
  shows loading feedback, matching the Config and Logs pages. Fixes
  [#40](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/40).

### Changed
- README, `START.md`, and `AGENTS.md` no longer claim "9-layer abuse
  prevention" without qualification. The new wording clarifies that
  rate-limiting is on by default; all other layers (captcha, hashcash,
  geo-IP, fingerprint, on-chain, AI) are opt-in via env vars. Fixes
  [#41](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/41).
- Helm chart bumped to `1.2.0` / `appVersion: 1.2.0`.
- Flutter SDK bumped to `1.2.0`.

## 1.1.5 (2026-04-17)

### Security
- **`GET /admin/audit-log` now requires authentication.** A prefix
  typo in the admin session gate (`/admin/audit` vs the actual route
  `/admin/audit-log`) let the audit log through without a session
  cookie. The log contains admin action history including operator IPs.
  Fixes [#43](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/43).
- **`POST /admin/auth/reset` now requires `FAUCET_ADMIN_PASSWORD`
  in the request body.** Previously unauthenticated — anyone who could
  reach the faucet could wipe all state. Still gated on
  `FAUCET_DEV=1` (404 in production). E2e tests updated to pass the
  password. Fixes
  [#44](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/44).

### Fixed
- **Regex-valid but checksum-invalid Nimiq address now returns 400**
  instead of leaking a raw `500 RPC_-32602` from the node. The claim
  route catches the RPC "invalid params" error and maps it to a
  user-friendly 400 response. (Full IBAN checksum validation in
  `parseAddress()` is planned for v1.2.0.) Fixes
  [#42](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/42).

### Changed
- Helm chart bumped to `1.1.5` / `appVersion: 1.1.5`.
- Flutter SDK bumped to `1.1.5`.

## 1.1.4 (2026-04-17)

### Fixed
- **WASM signer driver can now reach TestAlbatross consensus — the
  real fix for [#35](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/35).**
  Root cause was not a wire-protocol skew or Node-target bug: the
  bundled `@nimiq/core@2.2.2` seed list is all *mainnet* seeds
  (`aurora.seed.nimiq.com`, `catalyst.seed.nimiq.network`, …). A
  TestAlbatross client dialing those peers handshakes as testnet, the
  mainnet peers reject — every connection closes immediately; consensus
  never establishes. Nimiq maintainers confirmed this on 2026-04-16
  and shared the correct testnet seed.

  `NimiqWasmDriver` now defaults `seedPeers` to
  `['/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss']` when
  `network: 'test'` and no explicit override is provided. Mainnet still
  falls through to `@nimiq/core`'s bundled defaults. Explicit
  `seedPeers` in `NimiqWasmDriverConfig` always wins.

### Changed
- ROADMAP §1.1.2c updated: drops the "upstream-blocked on `@nimiq/core`
  refresh" framing. The failed `v1.3.0` publish workflow and the
  Node-target `addEventListener` warnings are still real, but neither
  blocks our use case. A `@nimiq/core` refresh would bring libp2p fixes
  from v1.3.0 but isn't required to unblock #35.
- Helm chart bumped to `1.1.4` / `appVersion: 1.1.4`.
- Flutter SDK bumped to `1.1.4`.

## 1.1.3 (2026-04-17)

### Fixed
- **RPC signer driver no longer crashes the container at boot when the
  RPC node is unreachable.** Previously `NimiqRpcDriver.init()` awaited
  `getNetworkId` (and in v1.1.2 also `listAccounts`/`importRawKey`/
  `unlockAccount`) synchronously — any DNS failure, ECONNREFUSED, or
  slow-starting node crashed the faucet container with
  `ENOTFOUND`/unhandled `DriverError`. `init()` now returns immediately
  after kicking off those RPC calls behind `readyPromise`, matching the
  WASM-driver pattern introduced in v1.1.0 (#36). `/healthz` comes up
  from t=0 regardless of RPC reachability; `/readyz` returns 503 until
  the background init succeeds. Driver-dependent routes (`POST
  /v1/claim`, admin account endpoints) stay gated behind the v1.1.0
  503 preHandler hook.
- **CI `compose-smoke` job was failing since v1.1.1** because the
  faucet's RPC driver hit `ENOTFOUND nimiq` when booted without the
  `local-node` profile. With the readiness decoupling above, the
  faucet service alone boots and `/healthz` responds — the job now
  passes without needing to run the nimiq node.

### Changed
- `NimiqRpcDriver` internal API: gained `readyPromise` (getter) and
  `isReady()` (method). Operational methods (`getBalance`, `send`,
  `waitForConfirmation`, `addressHistory`) each `await this.readyPromise`
  at the top, so a caller that invokes them before init settles simply
  blocks rather than seeing a stale/partial state.
- `NimiqRpcDriver.init()` tests split into "init returns immediately"
  vs "readyPromise resolves/rejects" to match the new contract.
- Helm chart bumped to `1.1.3` / `appVersion: 1.1.3`.
- Flutter SDK bumped to `1.1.3`.

### Caller-facing behaviour
- **Most operators see no change.** If the RPC node is reachable at
  boot, `init()` + `readyPromise` both succeed and operational calls
  work as before.
- **Operators with a briefly-unreachable RPC node at boot**: the faucet
  container stays alive and the admin UI loads; the driver-syncing
  banner shows until RPC becomes reachable; claims return `503
  Retry-After: 10` in the meantime.

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
