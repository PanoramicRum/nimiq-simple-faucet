# Roadmap

Post-1.0 plans for the Nimiq Simple Faucet. Items here are **not**
blockers for 1.0.0 — they ship in 1.1, 1.2, and beyond.

This file replaces the ad-hoc "Tier 3 polish" list from the 1.0.0
audit. Items are grouped by theme; priority within a theme is top-down
but themes can ship in parallel.

---

## 1.0.x — Pre-1.1 polish

Small items that improve the public-facing experience without feature
work. Shipped as point releases (1.0.1, 1.0.2, …) between 1.0.0 and 1.1.

### 1.0.3 — Docs directory restructure

**Status:** → absorbed into §3.0.4 (playground docs integration).

**Goal:** make `docs/` navigable at scale by grouping by audience.

**Scope:**
- Move operator docs to `docs/operators/`, integrator to `docs/integrators/`, maintainer to `docs/maintainers/`; keep the existing `docs/security/`.
- Leave backward-compat redirect stubs at the old paths so external links don't break mid-1.x.
- Update `docs/README.md` (the audience-grouped index) and any cross-links.

**Why deferred:** the existing `docs/README.md` index already solves the discovery problem; physical moves add churn without immediate payoff.

**Estimated effort:** half day.

### 1.0.4 — Dead-weight config cleanup

**Goal:** single source of truth for every config type.

**Scope:**
- Audit any split configs that accumulate during 1.0.x (e.g. the
  `deploy/docker/pnpm-workspace.docker.yaml` narrower-workspace pattern)
  and fold them into generators or document the exception clearly.
- Delete orphaned `.turbo`/`.next`/`.cache` dirs that sneak past the
  `.gitignore` if any appear.

**Estimated effort:** 1–2 hours.

### 1.0.5 — README / docs polish follow-ons

**Status:** → absorbed into §3.0 (screenshots replaced by live playground; badges already shipped in v1.3.0).

---

## 1.1 — Observability & operator polish

### 1.1.1 Prometheus `/metrics` endpoint

**Status:** ✅ shipped in v1.4.0.

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

**Status:** ✅ shipped in 1.1.0 as part of fixing #36. `/readyz`
reflects signer-driver readiness; Fastify binds its listener
immediately at boot, and driver-dependent routes return
`503 Retry-After: 10` until the driver signals ready via
`isReady()`. Helm `readinessProbe` → `/readyz` migration is a small
follow-up (see §1.1.2b below).

### 1.1.2a Expand `/readyz` to DB + Redis + wallet-balance ping

**Goal:** make `/readyz` a true dependency-chain probe, not just a
driver-readiness signal.

**Scope:**
- Extend `apps/server/src/app.ts` `/readyz` handler to additionally
  check DB connectivity (already implicitly tested by startup; add a
  lightweight `select 1`), Redis if the feature ships, and a driver
  `getBalance()` ping within a short timeout.
- Return a structured JSON body listing which dependency failed.

**Blocked on:** Redis dependency on server-side (ROADMAP §1.3.4).

**Estimated effort:** half day.

### 1.1.2b Helm chart probes migration

**Goal:** `readinessProbe` uses `/readyz`; `livenessProbe` stays on
`/healthz`.

**Scope:**
- Update `deploy/helm/templates/deployment.yaml` probes
- Update `docs/health-observability.md`

**Estimated effort:** 1 hour.

### 1.1.2c Refresh bundled `@nimiq/core` (housekeeping)

**Status:** ✅ the original #35 (WASM client can't reach TestAlbatross
consensus) was **resolved in v1.1.4**. Root cause: `@nimiq/core`'s
bundled seed list is all mainnet. We now default `seedPeers` to the
Nimiq-maintainer-confirmed testnet seed on `network: 'test'`.
Consensus reaches `/readyz` = `ready: true` within ~15 seconds on
TestAlbatross — verified on the `v1.1.4` image in real-world smoke.

**Optional follow-ups** (not blocking any user path):

1. **Bump `@nimiq/core`** when a refresh (2.3.x+) ships to npm.
   `@nimiq/core@2.2.2` works today thanks to the seed-peer fix, but
   v1.3.0 includes libp2p-layer hardening
   (peer contact-book poisoning fix, discovery-handler underflow, stale
   response-channels, etc.) worth picking up. Their
   [`Publish web-client to npm` v1.3.0](https://github.com/nimiq/core-rs-albatross/actions/runs/23671580580)
   workflow failed on 2026-04-01 with a wasm-bindgen version mismatch
   — a one-line fix on their side.
2. **Drop our testnet-seed default** if a future `@nimiq/core` ships
   network-aware seed defaults itself (so callers don't need per-network
   overrides).
3. **Remove the "does not currently reach claim-ready state" caveat**
   from the README smoke-test footnote (the footnote is stale after
   v1.1.4).

**Estimated effort:** a few hours once upstream publishes.

### 1.1.2d Sign RPC transactions locally (no key at the node)

**Goal:** remove the faucet's dependency on the Albatross node's wallet
manager holding unlocked key material.

**Today** (post-1.1.2): `NimiqRpcDriver.init()` auto-imports
`FAUCET_PRIVATE_KEY` into the node via `importRawKey` + `unlockAccount`,
and `send()` calls `sendBasicTransaction` which signs server-side at
the node. The key lives in two places (faucet env + node wallet
manager), which is an operator footgun.

**Target:** sign in-process with `@nimiq/core` primitives (the same
code paths `driver-nimiq-wasm` already uses for local signing) and
submit with `sendRawTransaction`. The node never sees the key; rotation
is a `.env` edit + container restart.

**Scope:**
- Extend `NimiqRpcDriver` with a local-signing path behind a config
  flag (e.g. `signLocally: true`) or make it the default once
  validated.
- Reuse `TransactionBuilder` / `KeyPair` from `@nimiq/core` the same
  way `NimiqWasmDriver.send()` already does.
- Drop `importRawKey` + `unlockAccount` from `init()` when signing
  locally.

**Blocked on:** §1.1.2c landing — a refreshed `@nimiq/core` on npm
would de-risk importing `@nimiq/core` purely for the signing primitives
(no WASM worker needed for signing; much smaller surface than the full
light-client init).

**Estimated effort:** ~1 day once §1.1.2c is resolved.

### 1.1.2e End-to-end CI claim smoke

**Goal:** CI coverage of the actual claim path (wallet import,
consensus, tx broadcast), not just "does the image boot."

**Today** (post-1.1.1): the `compose-smoke` CI job asserts the faucet
service starts + serves `/healthz` with `.env.example` values
applied. Catches `#39`-class regressions but not `#38`-class ones
(wallet not imported, -32603 on claim).

**Scope:**
- Boot the full local-node compose profile in CI.
- Provide a funded testnet wallet via GitHub Actions secrets (rotate
  quarterly) OR stand up a self-contained devnet with pre-funded
  genesis.
- After consensus, POST a claim and assert `{status:"broadcast", txId:…}`
  comes back within ~60s.
- Gate on a label or `workflow_dispatch` — consensus sync is slow and
  flaky, not every PR should pay that cost.

**Estimated effort:** 1 day (plus quarterly testnet-wallet refill if
we go the shared-wallet route).

### 1.1.3 Grafana dashboard JSON

**Status:** ✅ shipped in v1.5.1.

**Goal:** operators get a working dashboard on import, not a TODO.

**Scope:**
- `deploy/grafana/nimiq-faucet.json` — panels for balance, claim rate, success ratio, abuse decision distribution, p95 latency
- README in the same dir with import instructions

**Blocked on:** 1.1.1 (`/metrics`).

**Estimated effort:** half day.

### 1.1.4 Admin TOTP reset flow

**Status:** ✅ shipped in v1.3.0.

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

**Status:** → absorbed into §3.0.3 (interactive SDK showcase in the playground).

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

**Status:** → absorbed into §3.0.5 (the playground IS the hosted demo).

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

**Status:** ✅ shipped in v1.4.0.

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

**Status:** ✅ shipped in v1.7.0. Added `timeout` + `expired` statuses.

**Goal:** callers can distinguish "confirmed on-chain", "rejected up-front", "broadcast but timed out waiting", "abandoned after N retries".

**Scope:**
- Extend status enum in `apps/server/src/db/schema.ts` + OpenAPI schema
- Update `.catch` handlers in `apps/server/src/routes/claim.ts` to write the timeout state
- UI updates in `apps/dashboard` to display the new states

**Estimated effort:** half day.

### 1.3.3 Claim idempotency via integrator-supplied nonce

**Status:** ✅ shipped in v1.7.0. `idempotencyKey` field on POST /v1/claim.

**Goal:** integrators can retry safely — two claims with the same nonce within a window return the same id.

**Scope:**
- New optional field `idempotencyKey` on the claim request (validated as short string)
- Hash-key lookup in the `claims` table (new index) before doing any pipeline work
- Return the existing claim if found; otherwise proceed and record the key

**Estimated effort:** 1 day.

### 1.3.4 Server-side Postgres storage backend

**Status:** ✅ shipped in v1.5.0. Dual SQLite/Postgres + Redis rate-limit store.

**Goal:** make the server actually accept `DATABASE_URL=postgres://...` so the compose `postgres` profile and the Helm `postgresql` subchart work as documented.

**Context:** today [apps/server/src/db/index.ts](apps/server/src/db/index.ts) only accepts `sqlite:`/`file:` URLs and throws on everything else. The Postgres / Redis infrastructure is scaffolded (compose profile, Bitnami subcharts in Helm) but the server refuses to use it. Tracked by [#34](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/34).

**Scope:**
- Wire `drizzle-orm/node-postgres` alongside the SQLite branch in `openDb()`.
- Port the migrations in `db/index.ts` so they run on both backends (the schema is already trivial — mostly s/INTEGER/BIGINT, s/TEXT/VARCHAR).
- Add `@fastify/rate-limit` Redis store when `REDIS_URL` is set.
- Compose integration test: boot with `--profile postgres`, run the full e2e suite end-to-end.
- Un-gate the compose `postgres` profile defaults: drop the `profiles: ["postgres"]` gate on postgres + redis, re-add `DATABASE_URL` + `REDIS_URL` defaults, restore the `depends_on` block.
- Un-gate the Helm `postgresql.enabled=true` path in `deploy/helm/examples/values-prod.yaml`.
- Update [docs/deployment-production.md](docs/deployment-production.md) — drop the "planned" caveats, un-comment the Postgres example values, bump `replicaCount` guidance to support >1.

**Why deferred from 1.0:** SQLite + a PVC covers 95% of operators' actual traffic. Postgres unlocks `replicaCount > 1` which we already gate on at the Helm layer. Better to get this right than ship-and-patch under load.

**Estimated effort:** 2 days.

---

## 1.4 — Integrator-signed host context (per-field HMAC)

**Status:** ✅ shipped in v2.0.0. Per-field signature verification,
`verifiedIdentities`, `FaucetClient.signHostContext()`, identity
scoring bonus.

**Goal:** replace whole-request HMAC with field-level signing, so browser code can forward a signed `hostContext` without the integrator's backend having to proxy the whole claim.

**Context:** the `canonicalizeHostContext` function already exists in [packages/core/src/hostContext.ts](packages/core/src/hostContext.ts) but is not yet verified by the server. The `hostContext.signature` field is accepted and stored, but not trusted. Today, the only way to get `hostContextVerified: true` is whole-request HMAC (see [docs/integrator-hmac.md](docs/integrator-hmac.md)).

**Scope:**
- Server-side verification in the claim pipeline: if `hostContext.signature` present, recompute canonical, HMAC with the integrator's secret (needs integrator-id in the signature), set `hostContextVerified=true` when it matches
- Client-side helper in `@nimiq-faucet/sdk` so the browser SDK knows where to attach the signature
- New backend-only SDK method (Node + Go): `client.signHostContext(ctx)` returns `{ ...ctx, signature }` that can be forwarded to the browser
- Update `docs/integrator-hmac.md` with the per-field flow alongside the whole-request flow
- **Add `verifiedIdentities: string[]` to `HostContextSchema`** — SSO providers the integrator has authenticated the user against (e.g. `["apple", "google", "github"]`). Feed into `canonicalizeHostContext` so the signature covers it.
- **Scoring bonus for signed, identity-verified claims** — either extend `packages/abuse-ai` or spin a new `packages/abuse-identity` layer. Downgrade risk on `hostContextVerified: true` with ≥1 entry in `verifiedIdentities`. Lets operators pivot rate limiting from per-IP (cheap to rotate) to per-UID (hard to rotate).
- See [docs/fraud-prevention.md](docs/fraud-prevention.md) §2 for the user-facing pitch.

**Why this is 1.4, not 1.0:** it's a real API surface change, needs migration guidance, and the whole-request flow already works for the 80% use case.

**Estimated effort:** 2-3 days (base) + 1 day for `verifiedIdentities` scoring.

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

## 1.6 — Dependency sweep

**Status:** ✅ 6 of 8 shipped in v1.9.0. Remaining 2 (tailwindcss 4,
@vitejs/plugin-react 6) deferred to Vite 6 migration cycle.

**Goal:** burn down the deferred major-version bumps from the initial
Dependabot burst as a single coordinated upgrade, with full regression
coverage across SDKs + examples.

**Deferred upgrades to handle:**

| Package | From | To | Risk |
|---------|------|-----|------|
| `react`, `@types/react` (examples/nextjs, capacitor) | 18 | 19 | medium — verify Next.js + Capacitor examples |
| `zod` (server, core, all SDKs) | 3 | 4 | **high** — v4 is a breaking rewrite; biggest item |
| `@asteasolutions/zod-to-openapi` (server) | 7 | 8 | follows zod 4 |
| `fastify-type-provider-zod` (server) | 4 | 6 | follows zod 4 |
| `vite` (examples, apps) | 5 | 8 | medium — skip-major, config changes |
| `@capacitor/core`, `@capacitor/device` (sdk-capacitor, example) | 7 | 8 | medium |
| `vue-router` (dashboard) | 4 | 5 | medium — breaking API |
| `vue-tsc` (apps) | 2 | 3 | low — build-time only |
| `docker/setup-buildx-action` | 3 | 4 | low — CI action |
| `docker/setup-qemu-action` | 3 | 4 | low — CI action |
| `actions/checkout` | 4 | 6 | low — CI action |
| `actions/setup-node` | 4 | 6 | low — CI action |

**Approach:** branch per major-bump group, rebase-merge to `deps-sweep`
integration branch, run the full suite + all 5 examples + testnet smoke
before merging to main.

**Gate criteria (before tagging the release):**
- `pnpm test` — all unit + integration green
- `pnpm test:e2e` — Playwright green on chromium/firefox/webkit
- All 5 examples build + Docker-compose stack boots
- Live testnet smoke (`pnpm smoke:testnet`) passes end-to-end
- Trivy scan clean (no new HIGH/CRITICAL)
- At least one real integrator runs their app against a built image

**Estimated effort:** 3–5 days concentrated work.

**Note:** Dependabot's weekly cadence will keep re-opening patch/minor
PRs in the interim. Merge those as they come; queue the majors for this
sweep.

---

## 1.8 — Architecture cleanup (from April 2026 quality audit)

Filed from the [runtime core quality audit](docs/quality/runtime-core-quality-audit-2026-04.md).
Low-risk fixes shipped in PR #61; these are the larger follow-ups.

### 1.8.1 Refactor OpenAPI/runtime route schemas to a single source of truth

**Goal:** route validators (Zod) and OpenAPI docs (zod-to-openapi) are maintained in parallel today. Drift silently ships undocumented contracts (#49 was an example). Refactor to a shared contract module where each route declares its schema once.

**Tracked as:** [#57](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/57)

**Estimated effort:** 2-3 days.

### 1.8.2 Deduplicate runtime config mapping

**Goal:** Server config, admin config PATCH, /v1/config response, and the dashboard form all define the same fields independently. Refactor to a shared config catalog with derived types.

**Tracked as:** [#58](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/58)

**Estimated effort:** 2-3 days.

### 1.8.3 Reduce SQLite/Postgres schema duplication

**Goal:** `schema.sqlite.ts` and `schema.pg.ts` (introduced in v1.5.0) are hand-maintained mirrors. A schema descriptor that generates dialect-specific tables would eliminate the drift risk.

**Tracked as:** [#59](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/59)

**Estimated effort:** 2 days.

### 1.8.4 Unify React/Vue SDK hook engines

**Goal:** Both SDKs implement the same claim/status/stream lifecycle independently. A shared reactive core with framework-specific wrappers prevents cross-SDK drift.

**Tracked as:** [#60](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/60)

**Estimated effort:** 2 days.

---

## 3.0 — Developer Playground & UI Overhaul

A public-facing developer playground that demonstrates the faucet,
showcases every SDK, and serves as both the "try it" onboarding
experience and the documentation hub. The claim UI and admin dashboard
get a visual overhaul to match.

Absorbs §1.0.3 (docs restructure), §1.0.5 (screenshots), §1.2.2
(snippets), and §1.2.5 (hosted demo).

### 3.0.0 — Branding & design system

**Goal:** establish the visual language before writing UI code.

**Deliverable:** `docs/design/playground-design-brief.md` containing:
- Brand identity (Nimiq gold/amber, dark-mode-first, developer-tool aesthetic)
- Component inventory (buttons, cards, inputs, status indicators, code
  blocks, data tables, charts, badges)
- Page layout wireframes (claim flow, admin dashboard, playground landing,
  SDK showcase)
- Color system, typography, motion/animation specs
- Ready-to-use **Stitch prompts** — structured descriptions of each
  page/component for AI design generation. Each prompt includes purpose,
  exact content, visual references, and layout constraints.

**Estimated effort:** 1-2 days.

### 3.0.1 — Claim UI redesign

**Status:** ✅ shipped in v2.2.1. Vue Router (3 routes), Stitch "Porcelain
Vault" design, cat-as-claim-button, status dashboard, activity log with
detail modal, public stats API (`/v1/stats/summary`, `/v1/claims/recent`,
`/v1/events`), system error recording, auto wallet re-unlock.

**Estimated effort:** 2-3 days.

### 3.0.2 — Admin Dashboard redesign

**Goal:** modern admin experience matching the claim UI's visual identity.

**Scope:**
- Data tables with sorting/filtering/pagination
- Inline charts (claim rate, balance, latency — reuse `/metrics` data)
- Improved claims explain drawer with visual signal breakdown
- Config editor with live-preview of layer toggles
- Consistent Nimiq brand identity

**Estimated effort:** 3 days.

### 3.0.3 — Interactive SDK Showcase (Playground app)

**Status:** ✅ shipped in v2.2.1. VitePress playground with 8 path pages,
8 SDK pages, 6 example pages, monitoring, fraud prevention, analytics.
CardGrid component, build-time data loaders from START.md/frameworks YAML.
Deployed to GitHub Pages via `playground.yml` workflow.

### 3.0.4 — Docs integration

**Status:** ✅ shipped in v2.2.1. Playground pages use `<!--@include:-->`
to import from `docs/`, `packages/*/README.md`, `examples/*/README.md`,
`CONTRIBUTING.md`. Single source of truth — no content duplication.

### 3.0.5 — Public hosting

**Goal:** permanent public playground on testnet.

**Scope:**
- Deploy: playground + faucet server + testnet node (Docker Compose on
  VPS initially, Helm/k8s when traffic justifies)
- Public URL (e.g., `playground.nimiq-faucet.dev`)
- Restricted rate limits (1 claim/IP/day), testnet only
- DB-IP GeoIP enabled by default
- Linked from README, START.md, AGENTS.md
- Optional: embedded Grafana public snapshot with live metrics

**Estimated effort:** 1-2 days + ongoing hosting.

### 3.0.6 — Maneki-Neko visual polish

**Goal:** replace the PNG cat button with a custom SVG maneki-neko that
supports CSS-driven animations (paw wave, coin shimmer, idle bounce).

**Scope:**
- Commission or create a vector maneki-neko illustration (Figma/Illustrator)
  with separately addressable parts: body, paw, coin, ears
- Convert to inline SVG Vue component (`ManekiNeko.vue`) themed via CSS vars
  (gold coin = `--primary-container`, body = surface tiers)
- CSS keyframe animations:
  - Idle: subtle paw wave every ~4s
  - Hover: faster paw wave + coin shimmer
  - Disabled: grayscale, no animation
  - Loading (claim in flight): continuous paw wave + pulse
- Responsive design pass for all ClaimUI pages on mobile widths
- Accessibility: `prefers-reduced-motion` disables all animations

**Estimated effort:** 1-2 days (illustration) + 1 day (Vue component + animations).

### 3.0.7 — Example abuse layer integration

**Goal:** each example app demonstrates how to configure and use abuse
layers (captcha, hashcash, hostContext signing) in its framework.

**Scope:**
- Update Next.js, Vue, Capacitor, Flutter, Go, Python examples to show:
  - Enabling Turnstile/hCaptcha widget
  - Configuring hashcash difficulty
  - Passing `hostContext` with HMAC signing (backend examples)
  - Device fingerprint integration (Capacitor, React Native)
- Each example README gets an "Abuse layers" section explaining which
  layers are demonstrated and how to enable others
- Add env var examples to each project's `.env.example`

**Estimated effort:** 1-2 days.

### 3.0.8 — Admin Dashboard

**Goal:** operator-facing admin tools integrated into ClaimUI or as a
standalone extension, providing a unified experience for faucet management.

**Scope:**
- Wallet management: display faucet address and balance, withdraw funds
- Claim review: approve/deny pending claims, view abuse signals per claim
- Blocklist management: add/remove entries (IP, address, ASN, country)
- Runtime configuration: toggle abuse layers, adjust rate limits, tune thresholds
- Audit log: admin action history with timestamps and actor
- Unified design: match ClaimUI's Porcelain Vault theme
- Session auth with TOTP step-up for sensitive operations
- Can reuse ClaimUI's StatusPage as a base, extending with admin-only sections

**Estimated effort:** 3-4 days.

### 3.0.9 — Abuse layer ordering and weight configuration

**Goal:** let operators configure the pipeline execution order, layer
weights, and scoring thresholds via env vars or runtime config.

**Current state:** Layer order is hardcoded in `pipeline.ts`. Weights are
hardcoded per layer. Scoring thresholds (challenge at 0.4, review at 0.7,
deny at 0.85) are hardcoded defaults.

**Scope:**
- `FAUCET_PIPELINE_ORDER` env var — CSV of layer IDs to set execution order
- `FAUCET_PIPELINE_WEIGHTS` env var — CSV of `layer:weight` pairs
- `FAUCET_PIPELINE_CHALLENGE_THRESHOLD` — override default 0.4
- `FAUCET_PIPELINE_REVIEW_THRESHOLD` — override default 0.7
- `FAUCET_PIPELINE_DENY_THRESHOLD` — override default 0.85
- ClaimUI: support showing multiple challenge widgets simultaneously
  (currently only shows one: Turnstile > hCaptcha > Hashcash)
- Document the captcha + hashcash conflict and resolution

**Estimated effort:** 2 days.

### 3.0.10 — Hashcash checkbox widget mode

**Goal:** offer a checkbox-style CAPTCHA experience for the hashcash
layer, alongside the existing progress bar. The integrator chooses which
UX to use via config.

**Scope:**
- New `HashcashCheckbox.vue` component: checkbox → solves PoW in
  background → shows checkmark when done (familiar CAPTCHA UX)
- Config toggle: `FAUCET_HASHCASH_WIDGET=progress|checkbox` (default: progress)
- ClaimUI conditionally renders `HashcashRunner` or `HashcashCheckbox`
- Both widgets use the same server-side challenge/verify logic

**Estimated effort:** 1 day.

### 3.0.11 — ALTCHA / Cap integration

**Goal:** add open-source, self-hosted CAPTCHA alternatives as pluggable
abuse layers alongside existing Turnstile/hCaptcha/hashcash.

**Scope:**
- [ALTCHA](https://altcha.org/) — MIT licensed PoW CAPTCHA with mature
  widget ecosystem, WCAG 2.2 AA compliant, Docker deployment
- [Cap](https://capjs.js.org/) — Apache 2.0 PoW + JS instrumentation
  challenges, single Docker container
- New `packages/abuse-altcha/` and/or `packages/abuse-cap/` implementing
  `AbuseCheck` interface
- ClaimUI widget components for each
- Can run fully self-hosted with no third-party calls

**Estimated effort:** 2 days per integration.

### 3.0.12 — Image-based CAPTCHA (proof of humanity)

**Goal:** add an image-recognition CAPTCHA layer for operators who want
visual human verification without relying on commercial services.

**Context:** PoW challenges (hashcash, ALTCHA, Cap) prove the client spent
CPU but don't prove a human is present. Image CAPTCHAs ("select all
traffic lights") require visual understanding that is harder for bots.
However, self-hosted image CAPTCHAs are significantly weaker than
commercial ones (reCAPTCHA, hCaptcha) because they lack massive labeled
image datasets. This is a tradeoff between privacy/self-hosting and
security strength.

**Options to evaluate:**
- [LibreCaptcha](https://github.com/librecaptcha/lc-core) — self-hosted
  framework with text distortion + visual puzzles (Scala/JVM)
- Custom icon-selection challenge using open image datasets
- Integration with existing PoW layers (image challenge + PoW as fallback)

**Recommendation:** offer as an optional layer alongside Turnstile/hCaptcha.
Operators who need the strongest protection should still use commercial
services (free tiers available). Self-hosted image CAPTCHA is for operators
who prioritize privacy and self-sovereignty over maximum bot resistance.

**Estimated effort:** 3-5 days (research + implementation + image dataset).

### 3.0.13 — FCaptcha integration

**Goal:** add [FCaptcha](https://github.com/WebDecoy/FCaptcha) as a
pluggable self-hosted abuse layer, complementing §3.0.11 (ALTCHA/Cap).

**Context:** FCaptcha is an MIT-licensed, fully self-hosted CAPTCHA
stack that bundles SHA-256 proof-of-work with a behavioural + environmental
signal ensemble (mouse trajectory, micro-tremor, click precision, WebDriver
detection, headless-browser probing, typing rhythm). Offered in both
interactive-checkbox and invisible zero-click modes. Server ships in Go,
Python, and Node.js flavours; Docker-first, optional Redis for distributed
state.

**Why alongside §3.0.11:** FCaptcha is peer to ALTCHA / Cap in licensing
and self-hosting posture, but combines PoW with behavioural and
environmental signals in a single widget — a richer default than the
pure-PoW alternatives. Its invisible mode is a UX win for low-risk claims.

**Reuse, don't reinvent.** FCaptcha's detection pipeline (behavioural
scoring, environmental probes, PoW token issuance, verification) lives
in its own service — the widget produces a token that only FCaptcha's
`/api/verify` can validate. Do **not** port detection code into this
repo; our integration is a thin driver that delegates verification to
the upstream FCaptcha service, same pattern as `abuse-hcaptcha`. If
FCaptcha is missing a feature we need, contribute it upstream.

**Scope:**
- `packages/abuse-fcaptcha/` implementing the existing `AbuseCheck`
  interface, mirroring [`packages/abuse-hcaptcha`](packages/abuse-hcaptcha/)
  line-for-line: the driver's only job is `POST /api/verify` on the
  operator's FCaptcha service and translating the response into a
  `CheckResult`. No scoring logic lives in our package.
- Claim UI integration by embedding FCaptcha's own `fcaptcha.js`
  widget (script tag + host element), not a re-implementation. A small
  `FCaptchaWidget.vue` wrapper handles lifecycle + token handoff, the
  same way [`TurnstileWidget.vue`](apps/claim-ui/src/components/TurnstileWidget.vue)
  and [`HCaptchaWidget.vue`](apps/claim-ui/src/components/HCaptchaWidget.vue)
  wrap their upstream scripts.
- Config: `FAUCET_FCAPTCHA_URL`, `FAUCET_FCAPTCHA_SITE_KEY` (public,
  passed to the widget), `FAUCET_FCAPTCHA_SECRET` (server-side
  verification), `FAUCET_FCAPTCHA_MODE=checkbox|invisible` (default
  `checkbox`).
- Docker-compose profile under `deploy/compose/fcaptcha.yml` that pulls
  the upstream FCaptcha image, wires it next to the faucet, and
  documents the env-var handoff. No custom build.
- Docs page under `docs/abuse-layers/fcaptcha.md` covering setup, the
  upstream project link, threat model, and trade-offs vs. Turnstile /
  hCaptcha / ALTCHA / hashcash.
- Playground example under `apps/playground/abuse-layers/fcaptcha.md`.

**Out of scope (explicitly):**
- Re-implementing FCaptcha's behavioural-signal collection, PoW
  issuance, scoring, or verification inside this repo. If operators
  want those mechanics, they run FCaptcha — we don't fork it.
- Extending `abuse-fingerprint` with mouse/keyboard telemetry derived
  from FCaptcha's client code. That's FCaptcha's responsibility; our
  `hostContext` stays focused on integrator-supplied identity signals.

**Estimated effort:** 1 day (thin driver + widget wrapper + compose
profile + docs).

### 3.0.14 — Multi-theme system + NimiqPoW alt theme

**Status:** in-progress as of late April 2026. Foundation merged via
PRs #146 / #147 / #148 / #149 (rename, server registry, NimiqPoW theme,
Docker multi-theme bundling).

**Goal:** make the Claim UI pluggable so operators can pick between
multiple bundled themes with one env-var flip, and so community
contributors have a documented path to ship a new theme.

**Scope:**
- `apps/server/src/themes.ts` — central theme registry. Slug → display
  name + dist path (in repo + in Docker image).
- `FAUCET_CLAIM_UI_THEME=<slug>` selects which bundled theme the server
  serves at `/`. `FAUCET_CLAIM_UI_DIR` continues to win as an explicit
  operator override (custom themes outside the registry).
- `apps/nimiq-pow-ui/` — second theme: world-dot map + peer-pulse
  animation, recreating the visual language of the old
  [`nimiq/web-miner`](https://github.com/nimiq/web-miner). Decorative
  only — claims are still HTTP, no in-browser PoW.
- `docs/contributing-a-frontend.md` — full contract for community
  contributors (faucet API surface, dist/ requirements, theme
  registration steps, submission process).
- Docker image bundles every `apps/*-ui/dist/` so flipping themes
  needs no rebuild.

**Out of scope (explicitly):**
- Real proof-of-work mining in the browser (the old web-miner ran
  actual PoW; the alt theme is a visual tribute, not a functional
  mining client).

### 3.0.15 — Hub-API wallet integration for the NimiqPoW theme

**Status:** ✅ shipped in PR #150. `@nimiq/hub-api` is now a workspace
dep on `apps/nimiq-pow-ui/`; `useHub` selects the endpoint
(mainnet/testnet) from `/v1/config.network`; `ConnectWallet.vue`'s
primary path is a Hub button (`chooseAddress`) with a paste-address
fallback for users without a Hub account or in restricted WebViews.

**Remaining (deliberate):**
- Real-phone testing matrix — Android Chrome WebView, iOS WKWebView,
  Nimiq Pay app. The Hub popup behaviour varies by host; document the
  observed quirks in `docs/quality/hub-popup-mobile-matrix.md` after
  testing. Hardware-gated; expect to file as a follow-up to issue
  #121's WebView Origin investigation when that runs.
- Graduating the Hub flow from NimiqPoW into the default Porcelain
  Vault theme — separate decision on UX direction; today the default
  theme retains its existing paste-address UX.

**Why scoped to NimiqPoW first:** the existing Porcelain Vault theme
already has its own claim UX and changing it disrupts users on the
default. Land Hub integration in NimiqPoW first, validate with real-
phone testing, then graduate the pattern to other themes.

**Original scope (delivered):**
- Hub-API connect button replaces the paste input as the primary path
  (paste retained as fallback, not removed — better UX for newcomers
  without a Hub account yet).
- `@nimiq/hub-api` workspace dep scoped to the NimiqPoW theme only.
- Hub flow documented in `apps/nimiq-pow-ui/README.md`.

### 3.0.16 — User-facing theme picker dropdown (nice-to-have)

**Status:** ✅ shipped in PR #152. Server-side picker infrastructure
is in place; NimiqPoW theme is the reference implementation. Default
Porcelain Vault theme keeps its existing UI today — adding the picker
there is a single-component drop-in.

**Goal:** let visitors switch between bundled themes from a UI
control instead of having the operator decide at deploy time.

**Why a nice-to-have:** the env-var switch (§3.0.14) covers the
operator workflow. A user-facing picker is an opinionated UX
addition — useful for the playground / public demo, but probably
disabled in serious production deployments where the operator wants
brand consistency.

**What shipped:**
- `/v1/config.ui` exposes `theme` + `displayName` always; adds a
  `themePicker.themes[]` block listing every bundled theme when the
  operator opts in.
- Server honours `?theme=<slug>` query when the picker is enabled —
  serves the requested theme's `index.html` instead of the env default.
  Hashed asset paths route across all bundled themes (mounted as
  parallel static roots in `apps/server/src/ui.ts`).
- `apps/nimiq-pow-ui/src/components/ThemePicker.vue` — top-bar
  dropdown showing display names + descriptions. Selection writes the
  slug to `localStorage` and reloads with `?theme=<slug>`. On every
  load, JS reconciles localStorage with the URL so the user's last
  pick survives a direct visit to `/`.
- Operator opt-in: `FAUCET_THEME_PICKER_ENABLED=false` by default.
  Helm `claimUi.themePicker` value mirrors this.

**Remaining (deliberate):**
- Drop a similar `ThemePicker.vue` into `apps/claim-ui/` so the
  default Porcelain Vault theme also exposes the picker. The shape is
  ~100 lines following the NimiqPoW reference; deferred so the
  default theme's stable UX isn't churned in this PR.

## Future ideas (community contributions wanted)

These aren't on the roadmap — they're ideas the multi-theme system
makes possible. Contributions welcome; open an issue if you'd like
to discuss before starting.

### React / Svelte / SolidJS / vanilla TS themes

The frontend contract documented in [`docs/contributing-a-frontend.md`](docs/contributing-a-frontend.md)
is framework-agnostic by design — anything that produces a static
`dist/index.html` works. Reference implementations in non-Vue
frameworks would showcase the contract and give integrators
familiar starting points. PRs welcome under `apps/<framework>-ui/`.

### Themes inspired by other Nimiq-ecosystem visuals

The NimiqPoW theme proves the multi-theme model with a tribute to the
old web-miner. Other Nimiq-ecosystem visual heritage (early Wallet,
Nimiq Pay, the various community sites) could each become a theme.

---

# Beyond 1.x — Ongoing quality programs

These are continuous investments rather than a single release. They
start post-1.0 and run indefinitely.

## User testing

**Goal:** validate that the SDKs, recipes, and docs actually work for
people who aren't on the core team.

- **Beta integrator program** — recruit 3–5 Nimiq-ecosystem projects to
  build against the faucet pre-release. Feedback on SDK ergonomics,
  error messages, docs gaps. Track via GitHub Discussions.
- **Agent-assisted onboarding tests** — pair-test with Claude / Cursor /
  Copilot through AGENTS.md + `llms.txt`. Confirm an AI agent can take
  "add a faucet" from zero to working claim in under 5 minutes.
- **Public hosted demo** (see 1.2.5) doubles as a user-testing fixture —
  watch the claim rate, capture support requests, iterate.
- **Admin dashboard walkthroughs** — record the full first-run flow
  (TOTP enrolment, fund wallet, first claim, explain drawer). Embed in
  [docs/admin-first-run.md](docs/admin-first-run.md). Update after any
  dashboard change.
- **Docs-drift detection** — a weekly CI job that diffs `docs/*.md`
  against the code it references (env var names, file paths, API
  surface). Any stale reference files a low-priority issue. Prevents
  documentation from silently rotting as the code evolves.

## QA

**Goal:** the test suite catches everything we expect it to catch — not
just the happy path we wrote tests for.

- **Mutation testing** — wire `stryker-mutator` into CI on a monthly
  cadence. Any survived mutant is a gap in test intent; file issues.
- **Contract tests for every SDK** — parameterised suite that runs each
  SDK against a reference server fixture, asserting identical behaviour.
  Prevents SDK drift from the canonical TypeScript client.
- **Fuzz testing** — `fast-check` or similar on `POST /v1/claim` and
  `POST /v1/challenge`. Generate malformed JSON, unicode tricks, size
  edge cases, prototype pollution attempts. Integrate into nightly CI.
- **CI matrix expansion** — Node 20/22/24 × Postgres 14/15/16 × Redis
  7/8. Catches regressions when ecosystems drift.
- **Load test baseline** — run `tests/load/claim.js` on a fixed cloud
  runner weekly, graph results. Alert on >20% regression.
- **Visual regression** — `axe-playwright` already runs a11y checks;
  add screenshot diffs for the admin dashboard so UI regressions don't
  ship unnoticed.
- **Test coverage gate** — track `c8`/`v8` coverage; enforce no
  regression per PR.

## Security audits

**Goal:** move from "we followed OWASP" to "third parties verified we
did." A faucet holding real NIM deserves serious security hygiene.

### Internal (recurring)

- **Monthly dependency audit** — `pnpm audit --prod` + `cargo audit`
  (when Rust SDK lands) + `govulncheck` for Go SDK. Follow up on every
  HIGH/CRITICAL.
- **Quarterly OWASP Top 10 walkthrough** — file-by-file review mapping
  each endpoint to OWASP categories. Already scaffolded in
  [docs/security/owasp-top10.md](docs/security/owasp-top10.md); turn
  into a recurring ritual.
- **CodeQL + Gitleaks + Trivy** — already wired; keep action versions
  current and triage findings weekly.
- **Fuzz the abuse pipeline** specifically — mutate captcha tokens,
  hashcash solutions, host contexts. Score-drift bugs are silent in
  normal testing.

### External (pre-1.1 and then annually)

- **Third-party security audit** — engage one of:
  - Trail of Bits — full-code review, typical $30–80k
  - NCC Group — broad scope, similar pricing
  - Cure53 — web-app focused, fast turnaround
  - Least Authority — crypto-specific, good fit for the key-at-rest work

  Scope: server + signer drivers + abuse pipeline + admin auth.
  Publish the report post-fix as
  `docs/security/audit-<year>-<vendor>.md`.
- **Coordinated disclosure program** — publish `.well-known/security.txt`
  on the docs site; consider HackerOne or direct-mailbox bounty.
  Reference from [SECURITY.md](SECURITY.md).
- **Pen test of the hosted demo** — after 1.2.5 lands. Budget a week
  with a small firm or an internal red-team.

### Crypto-specific review

- **Argon2id parameters** — revisit annually against OWASP cheat sheet
  recommendations. Current: memory=64MiB, time=3, parallelism=4.
- **HMAC usage** — confirm `timingSafeEqual` on every comparison path,
  confirm body-byte-exactness in `signRequest`.
- **TOTP implementation** — `otplib` default params are fine today;
  reconfirm if the library rev-bumps.
- **Key-at-rest encryption** — `@noble/ciphers` XChaCha20-Poly1305 +
  Argon2id KDF. Re-review nonce strategy and KDF salts during audits.

### Bug bounty (optional, post external audit)

Only worth standing up once the external audit has cleaned the
low-hanging fruit. Budget $2–5k per valid HIGH finding as a starting
bounty pool. Host on HackerOne or Bugcrowd, or direct.

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
