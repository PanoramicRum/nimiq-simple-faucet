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

### 1.0.3 — Docs directory restructure (optional, non-breaking)

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

**Goal:** catch gaps that surface once real contributors start browsing.

**Scope:**
- Screenshots / GIFs in README + admin-first-run (previously deferred)
- Consider a `DEVELOPER.md` landing page that's more tour-oriented than `CONTRIBUTING.md`
- Badges for npm version of each SDK once they're published

**Estimated effort:** 1 day.

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

### 1.1.2c Refresh bundled `@nimiq/core` + diagnose Node-target peering

**Status:** upstream-blocked on an `npm` publish, plus likely a
separate Node-target bug to localize.

**The upstream situation** (as of 2026-04-16):

- `@nimiq/core` on npm is the WASM web-client subcrate of
  [`nimiq/core-rs-albatross`](https://github.com/nimiq/core-rs-albatross)
  — same codebase, same release cadence.
- Latest `core-rs-albatross` stable is
  [v1.3.0](https://github.com/nimiq/core-rs-albatross/releases/tag/v1.3.0)
  (2026-03-27), declared **backwards-compatible with all v1.x clients**.
- `@nimiq/core` on npm is stuck at `2.2.2` (embedding
  `core-rs-albatross/1.2.2`) because the
  [`Publish web-client to npm` workflow for v1.3.0](https://github.com/nimiq/core-rs-albatross/actions/runs/23671580580)
  failed on 2026-04-01 with a `wasm-bindgen` version mismatch
  (installed `wasm-bindgen-cli 0.2.117`; `Cargo.lock` pins
  `wasm-bindgen 0.2.114`). A one-line fix would unblock it.

**What we need to verify before blaming upstream for #35** (Node-target
WASM client can't reach TestAlbatross consensus):

- Backwards-compat claim says 1.2.2 clients should peer with 1.3.0
  nodes → wire-protocol skew is **probably not** the root cause.
- Our Node.js repro logs `addEventListener is not a function` warnings
  before the peer-close loop — hints at a Node-target-specific issue.
- Plausible alternative causes: stale seed list in `@nimiq/core 2.2.2`,
  Node-specific WASM path bug, libp2p transport bug fixed in 1.3.0 but
  not yet on npm.

**Scope:**

1. **Upstream ask:** nudge the Nimiq team to re-run the failed
   [v1.3.0 publish workflow](https://github.com/nimiq/core-rs-albatross/actions/runs/23671580580).
   After `@nimiq/core@2.3.x` lands, bump in
   `packages/driver-nimiq-wasm/package.json`.
2. **Narrowing experiments** (in parallel, don't wait on upstream):
   - Reproduce the WASM client in a browser (minimal Vite page) against
     TestAlbatross. If it peers, our bug is Node-target-specific.
   - Override `seedPeers` with our local compose
     `core-rs-albatross:1.4.0-pre1` node; if a known-good peer accepts
     us, the cause is seed-list staleness.
   - Raise the client to `config.logLevel('debug')` and capture
     libp2p close-reason codes; converts the opaque
     `Connection closed with peer` log into actionable evidence.
3. **Once a hypothesis is confirmed** — file a tighter upstream bug
   with the narrowed evidence, OR ship a seed-peer override in our
   driver config if it's a seed-list issue.
4. **CI:** re-enable the WASM consensus path in the docker-smoke step
   (today it warns-but-doesn't-fail — see
   `.github/workflows/ci.yml` lines 85-89) once WASM consensus is
   reliable end-to-end in our test pipeline.
5. **Docs:** drop the "does not currently reach claim-ready state"
   caveat from the README smoke-test footnote; update
   [#35](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/35)
   and close.

**Estimated effort:** 1 day for the narrowing experiments; a few
hours to consume a refreshed `@nimiq/core`; unknown for any
Node-target fix if one is needed.

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

### 1.3.4 Server-side Postgres storage backend

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
