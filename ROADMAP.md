# Roadmap

Post-1.0 plans for the Nimiq Simple Faucet. Items here are **not**
blockers for 1.0.0 — they ship in 1.1, 1.2, and beyond.

This file replaces the ad-hoc "Tier 3 polish" list from the 1.0.0
audit. Items are grouped by theme; priority within a theme is top-down
but themes can ship in parallel.

---

## 1.1 — Observability & operator polish

### 1.1.1 Prometheus `/metrics` endpoint

**Goal:** first-class metrics without polling `/v1/stats`.

**Scope:**
- Add `prom-client` or `fastify-metrics` to [apps/server](apps/server/)
- Expose `/metrics` under the same gating as `/openapi.json` (public or dev-only, configurable)
- Counters: `faucet_claims_total{status,decision,integrator}`,
  `faucet_claim_latency_seconds{phase}`, `faucet_abuse_layer_decision_total{layer,outcome}`,
  `faucet_rpc_errors_total{method,code}`
- Gauges: `faucet_wallet_balance_luna`, `faucet_consensus_established`,
  `faucet_pending_broadcasts`
- Add a new `FAUCET_METRICS_ENABLED` env var (default `true` in dev, `false` in prod unless opted in — CORS-style gating)

**Deliverables:**
- `apps/server/src/metrics.ts` with a registry factory and middleware
- Integration in `apps/server/src/app.ts` alongside `/healthz`
- Tests in `apps/server/test/metrics.e2e.test.ts` asserting format + key names
- `docs/health-observability.md` updated to reference `/metrics`

**Estimated effort:** 1 day.

### 1.1.2 `/readyz` endpoint

**Goal:** separate liveness (restart me) from readiness (route traffic to me).

**Scope:**
- New handler in `apps/server/src/app.ts`
- Checks DB connectivity, Redis (if enabled), driver `getBalance()` success within timeout
- Returns 200 only when all green; 503 with JSON detail otherwise
- Helm chart `readinessProbe` switches from `/healthz` to `/readyz`

**Deliverables:**
- Handler + unit test
- `deploy/helm/templates/deployment.yaml` updated
- Docs updated

**Estimated effort:** half day.

### 1.1.3 Grafana dashboard JSON

**Goal:** operators get a working dashboard on import, not a TODO.

**Scope:**
- `deploy/grafana/nimiq-faucet.json` — panels for balance, claim rate, success ratio, abuse decision distribution, p95 latency
- README in the same dir with import instructions

**Blocked on:** 1.1.1 (`/metrics`).

**Estimated effort:** half day.

### 1.1.4 Admin TOTP reset flow

**Goal:** operator can reset a lost TOTP without SQL surgery.

**Scope:**
- New CLI via the Docker image entrypoint: `docker exec ... node dist/admin-cli.js reset-totp`
- Alternative admin route guarded by a bootstrap env var: `FAUCET_TOTP_RESET_TOKEN`
- Documented in `docs/admin-first-run.md`

**Estimated effort:** half day.

---

## 1.2 — Publish automation & reach

### 1.2.1 Automated pub.dev publish in release workflow

**Goal:** one tag publishes everywhere, including Flutter.

**Scope:**
- Add a `publish-flutter` job to [.github/workflows/release.yml](.github/workflows/release.yml)
- Uses `dart-lang/setup-dart@v1`, `cd packages/sdk-flutter && dart pub publish --force`
- Needs a `PUB_DEV_PUBLISH_TOKEN` or OIDC-based trusted publishing (preferred)
- Update [docs/release-playbook.md](docs/release-playbook.md) to remove the manual step

**Estimated effort:** 1 day (pub.dev OIDC requires some setup).

### 1.2.2 Live `/snippets/<framework>` URLs

**Goal:** the "latest working snippet" URL referenced from each integration doc is actually generated and served.

**Scope:**
- New `scripts/generate-snippets.mts` at the repo root that:
  - Reads the SDK READMEs + AGENTS.md recipes
  - Writes per-framework pages to `apps/docs/public/snippets/<framework>.html`
  - Tags them with the current release version
- Add step to `release.yml` that runs it and commits to the docs branch / site
- Wire into the VitePress build so `https://docs.panoramicrum.com/snippets/react` returns a pinned copy

**Estimated effort:** 1-2 days.

### 1.2.3 README badges

**Goal:** signal project health at a glance.

**Scope:**
- Add to top of [README.md](README.md):
  - CI status (shields.io GitHub Actions)
  - npm version (@nimiq-faucet/sdk)
  - License (MIT)
  - Docker pulls from GHCR
  - Chart version

**Estimated effort:** 30 min.

### 1.2.4 `.github/FUNDING.yml`

**Goal:** GitHub sponsorship button if the project accepts donations.

**Scope:**
- One file with the right entries for GitHub Sponsors / OpenCollective / etc.
- Decide with project owner whether to enable

**Estimated effort:** 10 min.

### 1.2.5 Hosted public demo

**Goal:** a permanent `https://faucet-demo.panoramicrum.com` integrators can point at.

**Scope:**
- Deploy the release Helm chart to a small k8s cluster on any provider
- Restricted rate limits (e.g. 1 claim/IP/day)
- Point testnet traffic only
- Linked from README + docs

**Estimated effort:** 1 day, plus ongoing hosting cost.

---

## 1.3 — Reliability & data integrity

### 1.3.1 Reconciliation job for stuck `broadcast` claims

**Goal:** after a server restart, claims with `status=broadcast` that dropped their in-memory `waitForConfirmation` promise should still converge to `confirmed` or `rejected`.

**Context:** the RPC-driver fix in 1.0.0 made the poll loop resilient to transient RPC errors, but a restart *during* the await still orphans the claim. The row stays at `broadcast` until a human notices.

**Scope:**
- Background task in `apps/server/src/reconcile.ts` that runs every N minutes
- SELECT all claims with `status='broadcast'` and `createdAt > now - 24h`
- For each, call `driver.getTransactionByHash(txId)`; update `status` to `confirmed` or `rejected`
- Respects shutdown signals cleanly
- Enabled by default, gated by `FAUCET_RECONCILE_ENABLED=false` for ops who'd rather own it externally

**Deliverables:**
- New module + tests (mock driver, DB state assertions)
- Wired from `apps/server/src/app.ts` startup
- Admin audit log entry on every status flip
- Docs update in `health-observability.md`

**Estimated effort:** 1 day.

### 1.3.2 Richer claim status transitions

**Goal:** callers can distinguish "confirmed on-chain", "rejected up-front", "broadcast but timed out waiting", "abandoned after N retries".

**Scope:**
- Extend status enum in `apps/server/src/db/schema.ts` + OpenAPI schema
- Update `.catch` handlers in `apps/server/src/routes/claim.ts` to write the timeout state
- UI updates in `apps/dashboard` to display the new states

**Estimated effort:** half day.

### 1.3.3 Claim idempotency via integrator-supplied nonce

**Goal:** integrators can retry safely — two claims with the same nonce within a window return the same id.

**Scope:**
- New optional field `idempotencyKey` on the claim request (validated as short string)
- Hash-key lookup in the `claims` table (new index) before doing any pipeline work
- Return the existing claim if found; otherwise proceed and record the key

**Estimated effort:** 1 day.

---

## 1.4 — Integrator-signed host context (per-field HMAC)

**Goal:** replace whole-request HMAC with field-level signing, so browser code can forward a signed `hostContext` without the integrator's backend having to proxy the whole claim.

**Context:** the `canonicalizeHostContext` function already exists in [packages/core/src/hostContext.ts](packages/core/src/hostContext.ts) but is not yet verified by the server. The `hostContext.signature` field is accepted and stored, but not trusted. Today, the only way to get `hostContextVerified: true` is whole-request HMAC (see [docs/integrator-hmac.md](docs/integrator-hmac.md)).

**Scope:**
- Server-side verification in the claim pipeline: if `hostContext.signature` present, recompute canonical, HMAC with the integrator's secret (needs integrator-id in the signature), set `hostContextVerified=true` when it matches
- Client-side helper in `@nimiq-faucet/sdk` so the browser SDK knows where to attach the signature
- New backend-only SDK method (Node + Go): `client.signHostContext(ctx)` returns `{ ...ctx, signature }` that can be forwarded to the browser
- Update `docs/integrator-hmac.md` with the per-field flow alongside the whole-request flow

**Why this is 1.4, not 1.0:** it's a real API surface change, needs migration guidance, and the whole-request flow already works for the 80% use case.

**Estimated effort:** 2-3 days.

---

## 1.5 — Future SDKs & framework coverage

### 1.5.1 React Native native-mobile example

**Goal:** fill the gap where the integration doc currently says "see AGENTS.md for a recipe".

**Scope:**
- `examples/react-native-claim-app/` — actual Expo app
- Dockerfile for web-preview mode (same pattern as capacitor example)
- Device fingerprint integration via `react-native-device-info`

**Estimated effort:** half day.

### 1.5.2 Python SDK

**Goal:** cover Django/Flask/FastAPI integrators.

**Scope:**
- `packages/sdk-python/` mirroring the Go SDK (pure stdlib where possible)
- Published to PyPI with a new workflow job
- Docs + example under `examples/python-backend-integration/`

**Estimated effort:** 2 days.

### 1.5.3 Rust SDK

**Goal:** feature parity for Rust backends and wasm-first frontends.

**Scope:**
- `packages/sdk-rust/` crate mirroring the Go SDK
- Published to crates.io
- Docs + example

**Estimated effort:** 2-3 days.

---

## Guiding principles

When picking what to do next, optimize for:

1. **Operator confidence** — monitoring, backups, upgrades. Integrators can tolerate missing features; operators cannot tolerate surprises.
2. **Signal parity** — every SDK, every deploy mode exposes the same `hostContext` + claim surface. Don't add features to TS-only that would make the others feel second-class.
3. **Small tests, clear names** — every item in this roadmap should land with regression tests. No quiet features.

---

## Out of scope

Explicitly **not** planned:

- Multi-tenant hosting (one faucet = one operator). Run multiple instances if you need multi-tenant.
- Fiat on/off ramps. This is a NIM faucet, not a payment processor.
- Non-Nimiq drivers in core packages. If you want BTC/ETH/other, fork the `CurrencyDriver` interface and build your own — the architecture is chain-agnostic by design, but shipping multi-chain in the default image would explode scope.

---

*This roadmap is a living doc. Propose additions via a PR that edits this file.*
