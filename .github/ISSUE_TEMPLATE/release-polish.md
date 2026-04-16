---
name: Release polish tracker
about: One-shot tracking issue for the v0.1.0 public-release polish pass
title: "Release polish — v0.1.0 public release"
labels: ["release", "tracking"]
assignees: []
---

Tracking issue for the polish pass that takes the repo from "builds and tests pass" to "ready to publish as a public repo." Mirrors [`docs/release-polish-plan.md`](../blob/main/docs/release-polish-plan.md).

Close this issue when **Phase 6 gate** passes: the faucet is running at a public URL, docs are up, image pulls, SDKs install, and the first external issue has been triaged.

---

## Phase 1 — Correctness and testing

### 1.1 Nimiq driver validation against real infrastructure
- [ ] Stand up a local or hosted Nimiq Albatross testnet RPC node (or point at a public one).
- [ ] Exercise `@faucet/driver-nimiq-rpc` end to end: `init`, `getBalance`, `send`, `waitForConfirmation`, `addressHistory`.
- [ ] Confirm every JSON-RPC method name used in `packages/driver-nimiq-rpc/src/index.ts` exists in current Albatross; adjust wrong ones.
- [ ] Validate `@faucet/driver-nimiq-wasm` in Node against the same testnet (new integration test).
- [ ] Cross-check response shapes; loosen or tighten `undici`-based typing.
- [ ] Manual faucet round-trip: fund → `docker run` → claim from `apps/claim-ui` → verify tx on block explorer.

### 1.2 Playwright: every spec green
- [ ] `pnpm test:e2e:install` then `pnpm test:e2e` locally (chromium, firefox, webkit).
- [ ] Fix the 5 currently failing specs against the real UI DOM (selectors + timing).
- [ ] Add `expect.toPass({ timeout })` for flaky async flows (WS confirmation).
- [ ] Suite runs against built `dist/` of both UIs (not dev mode).
- [ ] Wire `pnpm test:e2e` into `.github/workflows/ci.yml` as a separate job, browser cache included.
- [ ] Baseline + human-review visual-regression snapshots for `/` and `/admin/login`.

### 1.3 Load and resilience
- [ ] `tests/load/claim.js` runs for 5 min against local faucet + stub driver; thresholds pass.
- [ ] Node heap stabilises — no leak.
- [ ] Chaos: kill SQLite mid-claim, restart, recovery works.
- [ ] `HEALTHCHECK` reflects real readiness, not just port-open.

### 1.4 Dependency freshness pass
- [ ] `pnpm update -r --latest` in a branch; resolve breakages.
- [ ] `pnpm audit --prod`: zero HIGH/CRITICAL.
- [ ] Resolve the `react-native` peer warning (React 18 vs. 19).

**Gate:** automated checks green in CI for 2 consecutive runs + real testnet claim works end to end.

---

## Phase 2 — Security audit

### 2.1 Automated scans
- [ ] CodeQL workflow runs clean; findings triaged.
- [ ] Trivy: zero HIGH/CRIT on the built image.
- [ ] `gitleaks` on full history; rotate any leaked secret before publishing.
- [ ] `pnpm audit --prod`: clean.
- [ ] Add and run `eslint-plugin-security` + `eslint-plugin-no-secrets`.
- [ ] SBOM generated on a dry-run tag via `sbom.yml` and inspected.

### 2.2 Manual review — per-route walk (`/v1/*`, `/admin/*`, `/mcp`)
- [ ] Input validation at every boundary, no inherited trust.
- [ ] No stack traces, DB errors, env paths leaked in responses.
- [ ] All secret comparisons use `crypto.timingSafeEqual`.
- [ ] Every mutating admin route requires session + CSRF.
- [ ] Step-up routes actually enforce TOTP (`requireTotpStepUp` on `/admin/account/send` and `/admin/account/rotate-key`).

### 2.3 Manual review — cryptography
- [ ] Argon2id params match OWASP 2026 guidance (`m=19 MiB, t=2, p=1` or stronger).
- [ ] If using scrypt fallback, document it as explicit downgrade.
- [ ] XChaCha20-Poly1305 nonce is 24 bytes, never reused, CSPRNG-sourced.
- [ ] HMAC secrets ≥32 bytes entropy on generation.
- [ ] Session tokens ≥32 bytes; stored as SHA-256 hash only.
- [ ] TOTP secret uses 160-bit entropy.
- [ ] Private key never crosses `console.log`, error messages, or HTTP responses (grep + review).

### 2.4 Manual review — abuse pipeline
- [ ] Every `AbuseCheck.check`: soft-skip on external-provider failure (no silent allow-through).
- [ ] `packages/abuse-geoip` private-IP short-circuit covers IPv6 (`fc00::/7`, `::1`).
- [ ] Hashcash challenge expiry enforced; nonces not replayable across challenges.
- [ ] Fingerprint: Drizzle backend doesn't leak `uid`/`cookieHash` in errors.

### 2.5 Threat-model refresh
- [ ] Walk `docs/security/threat-model.md` STRIDE table against current code.
- [ ] Fill `SECURITY.md` placeholders: real contact, real PGP key (or remove), realistic SLO.
- [ ] Sidebar links to `SECURITY.md` once public.

### 2.6 Secrets & config hygiene
- [ ] Every env var in `apps/server/src/config.ts` is in `.env.example`.
- [ ] `.env.example` has zero real secrets.
- [ ] `.gitignore` covers `.env`, `*.db`, `data/`, `dist/`, `.turbo/`.
- [ ] `pnpm-lock.yaml` committed.

**Gate:** no HIGH/CRITICAL findings; every item in `docs/security/hardening-checklist.md` is human-checked.

---

## Phase 3 — Documentation polish

### 3.1 README
- [ ] Replace every placeholder `#` with the real repo URL.
- [ ] Add live-demo link (or remove that claim).
- [ ] Add a GIF or screenshot of the claim UI at the top.
- [ ] Verify the Docker one-liner works from a clean machine.
- [ ] Badges row: CI, CodeQL, License, image size, latest version.
- [ ] Cross-link `AGENTS.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`.

### 3.2 New files
- [ ] `CONTRIBUTING.md` — dev setup, turbo tasks, how to add abuse providers / drivers, commit style.
- [ ] `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1.
- [ ] `.github/ISSUE_TEMPLATE/bug_report.md`, `feature_request.md`.
- [ ] `.github/ISSUE_TEMPLATE/config.yml` — direct security to `SECURITY.md`, questions to Discussions.
- [ ] `FUNDING.yml` if applicable.

### 3.3 VitePress site (`apps/docs`)
- [ ] Resolve every `TODO` (`grep -rn TODO apps/docs/`).
- [ ] Replace `faucet.nimiq.example` in `config.mts` with real hostname.
- [ ] Screenshots on `guide/quick-start.md` and `guide/deployment.md`.
- [ ] "When to use this vs. hosted Nimiq faucets" on the homepage.
- [ ] Proofread every `integrations/*.md`; run each snippet in a scratch project.
- [ ] Link hosted `/openapi.json` from `api/overview.md` once demo is up.
- [ ] Versions dropdown structure in place.

### 3.4 llms.txt and AGENTS.md
- [ ] Regenerate `/llms.txt` and `/llms-full.txt` from the actual endpoint inventory (new `tools/build-llms.ts`).
- [ ] Validate with an AI client: have Claude Code add the faucet to a blank Next.js app using only docs — iterate until it works.
- [ ] Spot-check every SDK's `llms.txt`.

### 3.5 In-code docs
- [ ] Every exported function in `@faucet/core` and `@nimiq-faucet/sdk` has a JSDoc + example.
- [ ] Every `llms.txt` reflects current surface.
- [ ] Run `typedoc`/`api-extractor` once; inspect output for broken exports.

**Gate:** a fresh developer (who hasn't seen the project) can clone, `docker run`, claim, and integrate an SDK from docs alone.

---

## Phase 4 — UI polish

### 4.1 Claim UI (`apps/claim-ui`)
- [ ] Design pass: spacing, type scale, colour contrast AA in light + dark.
- [ ] Mobile 320 px – 430 px viewport test; tap targets ≥44×44.
- [ ] Loading states for config fetch, hashcash solve, claim submit, confirmation.
- [ ] Error states: rate-limited, geo-blocked, VPN-blocked, captcha failed, WS disconnected, invalid address — friendly, actionable copy.
- [ ] Success state: tx hash copy-chip + "View on block explorer" (resolve `TODO` in `apps/claim-ui/src/lib/explorer.ts`).
- [ ] Empty / depleted state: "temporarily depleted" copy when balance insufficient.
- [ ] Brand colours in a single `theme.ts` for easy re-skinning.
- [ ] Audit `src/i18n/en.ts` for coverage; no bare literals in templates.
- [ ] Capture screenshots of each state; add to docs.

### 4.2 Admin dashboard (`apps/dashboard`)
- [ ] Decide: keep hand-rolled QR or drop in a small `qrcode` dep for reliability.
- [ ] Mobile: sidebar collapse → overlay (not push).
- [ ] Overview: confirm server emits stream event types `claim.broadcast`, `claim.confirmed`, `admin.audit`; wire exactly those.
- [ ] Claims table: pagination + sortable columns + empty state.
- [ ] Claim drawer: pretty-print `signalsJson`, collapsible per-layer, highlight AI top contributors.
- [ ] Blocklist: search + filter by kind.
- [ ] Integrators: once-shown secrets force an "I've copied it" checkbox; copy buttons with feedback.
- [ ] Account: rotate-key modal requires typing `ROTATE` + TOTP.
- [ ] Config: show a diff before save; TOTP step-up for sensitive fields.
- [ ] Logs: auto-scroll toggle, pause-on-hover, CSV export.
- [ ] a11y spec: zero `serious`/`critical` violations.

### 4.3 Shared
- [ ] Consistent favicon (`apps/*/public/favicon.svg`).
- [ ] OG image + meta tags on both UIs.
- [ ] Production source maps uploaded privately (not shipped in the image).

**Gate:** both UIs pass axe-clean, work on a phone, survive a design review.

---

## Phase 5 — Release readiness

### 5.1 Versioning
- [ ] Decide starting version: **`0.1.0`** recommended.
- [ ] Bump every workspace package; record "Initial public release" changeset.
- [ ] Pin floating dep ranges (`^1.2` not `^1`).

### 5.2 Package publishing prep
- [ ] Decide npm scope (`@nimiq-faucet/*` public; `@faucet/*` internal stays `private: true`).
- [ ] Public packages: `sdk`, `react`, `vue`, `capacitor`, `react-native`.
- [ ] Each public package has correct `name`, `version`, `description`, `keywords`, `license`, `author`, `repository.url`, `homepage`, `bugs.url`, `files`, `README.md`, `llms.txt`.
- [ ] Go module: decide final path (`github.com/<org>/simple-faucet-go`) — separate repo or subdir with Go-module semver.
- [ ] Flutter: confirm `pub.dev` requirements (topics, example, CHANGELOG).
- [ ] Helm: confirm OCI namespace (`oci://ghcr.io/<org>/charts`).

### 5.3 Registry placeholder sweep
Replace `ghcr.io/nimiq/*` with real namespace in:
- [ ] `deploy/helm/values.yaml`
- [ ] `deploy/helm/README.md`
- [ ] `apps/docs/guide/quick-start.md`
- [ ] Root `README.md`
- [ ] `.github/workflows/release.yml`
- [ ] `.github/workflows/trivy.yml`

### 5.4 Workflow pre-flight
- [ ] Dry-run `release.yml` via `act` or a throwaway `v0.1.0-rc1` tag on a private fork.
- [ ] Confirm GitHub secrets: `NPM_TOKEN`, `PUB_DEV_CREDENTIALS_JSON`, any `COSIGN_*`.

### 5.5 Legal
- [ ] `LICENSE` year and copyright holder correct.
- [ ] Third-party code compatible with MIT (spot-check every dependency's license).
- [ ] `@nimiq/core` license compatibility verified or documented.
- [ ] **Trademark**: confirm "Nimiq" usage acceptable to the Nimiq Foundation, or rename (`nimiq-community-faucet`).

**Gate:** fresh `git clone`, `pnpm install && pnpm build && pnpm test`, and `docker build` all succeed on a clean machine with zero placeholder URLs.

---

## Phase 6 — Publish to a public repo

### 6.1 Repo setup
- [ ] Create public GitHub repo at `<org>/<repo-name>`.
- [ ] Require PR reviews, passing checks (CI + CodeQL + Trivy), dismiss stale reviews.
- [ ] Protect `main`; require linear history.
- [ ] Enable Discussions (Q&A), Issues, Security Advisories, Dependabot alerts.
- [ ] Set repo topics: `nimiq`, `faucet`, `crypto-faucet`, `blockchain`, `payout`, `mcp-server`, `abuse-prevention`, `self-hosted`.
- [ ] Optional: require `Signed-off-by` (DCO) or signed commits.

### 6.2 First push
- [ ] Squash AI-build history into a single commit (or a curated 5–10 that tell the story).
- [ ] Run `gitleaks` on the squashed history.
- [ ] `git push origin main`.

### 6.3 First release
- [ ] `pnpm changeset version` → bumps versions + generates CHANGELOG.
- [ ] Merge the version PR.
- [ ] Tag `v0.1.0` and push.
- [ ] `release.yml` fires: multi-arch image, npm, Helm OCI, OpenAPI freeze PR, GH Release.
- [ ] `sbom.yml` attaches CycloneDX SBOMs.
- [ ] Smoke test published image on a clean machine.
- [ ] Smoke test one published SDK in a scratch project.
- [ ] Smoke test Helm chart on `kind`/`k3d`.

### 6.4 Docs site live
- [ ] Decide host: GH Pages / Cloudflare Pages / self-host. Default: GH Pages on latest tag.
- [ ] Publish `apps/docs/dist` to chosen host.
- [ ] Every link resolves.
- [ ] DNS (if using custom domain).

### 6.5 Announcement
- [ ] Pin a "Status: v0.1.0 known limitations" issue with open items from this tracker.
- [ ] Post to Nimiq community channels, `/r/nimiq`, `/r/selfhosted` as appropriate.
- [ ] Submit to awesome-lists (awesome-nimiq, awesome-selfhosted, awesome-mcp).

### 6.6 Post-release monitoring (first week)
- [ ] Triage first-48h issues; ship `v0.1.1` with the most common fixes.
- [ ] Confirm Dependabot opens PRs on schedule.
- [ ] Confirm CodeQL + Trivy run weekly.
- [ ] Sanity-check npm downloads + image pulls are non-zero.

**Gate:** faucet running at a public URL; docs up; image pulls; SDKs install; first external issue triaged.

---

## Explicitly out of scope for v0.1.0

- External third-party security audit
- Live hot-reload of `/admin/config` (persists but not applied until restart)
- Hot-swap of faucet signing key after rotation
- Per-layer weight sliders in dashboard's abuse view
- ONNX-backed AI scoring model (rules ship; ONNX hook is future)
- Postgres migration path from SQLite
- Multi-tenant mode
- Real-time translations (only `en`)

---

## How to use this tracker

1. Assign yourself (or split phases among the team).
2. Work a phase at a time — don't tick items across phases in parallel; gates are there for a reason.
3. Close this issue only after Phase 6 gate passes.
4. If an item is deferred, move it to `docs/release-polish-plan.md` under "Not in scope" and delete from here.

Full plan: [`docs/release-polish-plan.md`](../blob/main/docs/release-polish-plan.md).
