# Release Polish Plan

A disciplined pass from "everything builds and tests pass" to "ready to publish as a public repo."

## Context

Most of the code in this repository was produced in a single multi-agent build session. It compiles, the vitest suite is green (86 tests), and a Playwright scaffold exists. But the codebase has **not** been exercised end-to-end against real Nimiq infrastructure, and several files carry explicit `TODO` / placeholder markers (repo URL, security contact, PGP key, block-explorer URLs, publishing namespace, etc.). A naive `git push` to a public repo today would ship those placeholders and any latent bugs to the world.

This plan breaks the polish into six phases. Each phase ends with a go / no-go gate. The final phase is the actual publish.

**Estimated wall-clock time:** 2–3 weeks of one engineer's focused time, or ~4 weeks part-time. Don't rush; the point of a polish pass is that it's thorough.

---

## Phase 1 — Correctness and testing (week 1)

Goal: every automated check runs, passes, and means something.

### 1.1 Nimiq driver validation against real infrastructure
- [ ] Stand up a local or hosted **Nimiq Albatross testnet** RPC node (or point at a public one) and exercise `@faucet/driver-nimiq-rpc` end to end: `init`, `getBalance`, `send`, `waitForConfirmation`, `addressHistory`.
- [ ] Confirm every JSON-RPC method name used in `packages/driver-nimiq-rpc/src/index.ts` actually exists in current Albatross (`getAccountByAddress`, `sendBasicTransaction`, `getTransactionByHash`, `getTransactionsByAddress`, `getConsensusState`). Adjust any that are wrong.
- [ ] Validate `@faucet/driver-nimiq-wasm` in Node: `pnpm --filter @faucet/driver-nimiq-wasm test` (write a new integration test that actually boots the WASM client and waits for consensus against testnet).
- [ ] Cross-check response shapes — log one real response per RPC call and diff against the `undici`-based typing; loosen or tighten types accordingly.
- [ ] Run a manual faucet round-trip: fund a test wallet, run `docker run ...`, claim from `apps/claim-ui`, verify tx on the testnet block explorer.

### 1.2 Playwright: make every spec green
- [ ] `pnpm test:e2e:install` then `pnpm test:e2e` locally (all three browsers).
- [ ] Fix the 5 currently failing specs against the real UI DOM (selectors + timing). Suspect issues: hashcash progress-bar selector, admin login first-time flow, rate-limit 429 vs. 403 shape.
- [ ] Add retry-ability: `test.step` wrappers and `expect.toPass({ timeout })` for flaky async flows (WS confirmation).
- [ ] Ensure the Playwright suite runs against the built `dist/` of both UIs (not dev mode) so it mirrors production.
- [ ] Wire `pnpm test:e2e` into `.github/workflows/ci.yml` as a separate job with `playwright-browsers` cached.
- [ ] Baseline visual-regression snapshots for `/` and `/admin/login`. Review them. Commit only after human inspection.

### 1.3 Load and resilience
- [ ] Run `tests/load/claim.js` against a local faucet + stub driver for 5 minutes. Confirm thresholds pass.
- [ ] Watch the process for memory leaks — Node heap should stabilise.
- [ ] Chaos test: kill SQLite mid-claim, restart, confirm recovery.
- [ ] Confirm `HEALTHCHECK` in the Dockerfile fires and reflects real readiness (the port-open check is currently shallow).

### 1.4 Dependency freshness pass
- [ ] `pnpm update -r --latest` in a scratch branch; resolve any breakages.
- [ ] `pnpm audit --prod` — zero HIGH/CRITICAL before merge.
- [ ] Review `react-native` peer warning (`react@^19` vs. `react@18.3.1` in workspace) and decide: pin RN ≤0.74 (React 18) or bump React to 19 across the workspace.

**Gate:** all automated checks green in CI for 2 consecutive runs. A real testnet claim works end to end.

---

## Phase 2 — Security audit (week 1–2)

Goal: exactly the hardening the `docs/security/hardening-checklist.md` promises, verified by eye.

### 2.1 Automated scans (already wired; verify)
- [ ] CodeQL: run the workflow, fix any findings. Pay attention to injection, path traversal, prototype pollution.
- [ ] Trivy: scan the built image. Fix any HIGH/CRIT OS-level or library CVEs (often a base-image bump).
- [ ] `gitleaks` scan on the full history; if any secret ever landed, rotate it before publishing.
- [ ] `pnpm audit --prod` clean.
- [ ] Add `eslint-plugin-security` and `eslint-plugin-no-secrets` to the monorepo and run them.
- [ ] Generate SBOMs via `sbom.yml` on a dry-run tag and inspect.

### 2.2 Manual review — per-route walk
For each of `/v1/*`, `/admin/*`, `/mcp`, and the UIs:
- [ ] Re-read the handler. Confirm input validation lives at the boundary and no trust is inherited.
- [ ] Confirm response shape can't leak internals (stack traces, DB error messages, `env`, file paths).
- [ ] Confirm every secret comparison is timing-safe (`crypto.timingSafeEqual`).
- [ ] Confirm mutating routes require CSRF + session.
- [ ] Confirm step-up-requiring routes actually enforce the TOTP check (grep for `requireTotpStepUp` on `/admin/account/send` and `/admin/account/rotate-key`).

### 2.3 Manual review — cryptography
- [ ] Argon2id parameters match current OWASP guidance (today: `m=19 MiB, t=2, p=1`). If still using the scrypt fallback, document it as an explicit downgrade.
- [ ] XChaCha20-Poly1305 keyring nonce is 24 bytes, never reused, read from a CSPRNG.
- [ ] HMAC secrets ≥ 32 bytes entropy on generation.
- [ ] Session tokens ≥ 32 bytes, stored as SHA-256 hashes only.
- [ ] TOTP secret uses 160-bit entropy (`base32` 32 chars).
- [ ] Private key on disk is NEVER readable in logs, error messages, or HTTP responses — confirm with a grep and a review of every log call around `apps/server/src/auth/keyring.ts`.

### 2.4 Manual review — abuse pipeline
- [ ] Every `AbuseCheck.check` implementation: confirm soft-skip on external provider failure (no silent allow-through on a mistyped API key).
- [ ] Geo-IP / IPinfo: verify private-IP short-circuit in `packages/abuse-geoip/src/check.ts` actually catches IPv6 (`fc00::/7`, `::1`).
- [ ] Hashcash: confirm challenge expiry is enforced and nonces aren't replayable across challenges.
- [ ] Fingerprint: confirm the Drizzle backend doesn't leak uid/cookieHash in error paths.

### 2.5 Threat-model refresh
- [ ] Walk `docs/security/threat-model.md` STRIDE table against the current code — ensure every mitigation claimed is actually present.
- [ ] Fill the `SECURITY.md` placeholders: real contact email (or GitHub Security Advisories URL), real PGP key (or remove the PGP claim), real response SLOs you can keep.
- [ ] Add a `SECURITY.md` link from the repo sidebar once public.

### 2.6 Secrets & config hygiene
- [ ] Every env var in `apps/server/src/config.ts` is also in `.env.example`.
- [ ] `.env.example` has zero real secrets.
- [ ] `.gitignore` covers `.env`, `*.db`, `data/`, `dist/`, `.turbo/`.
- [ ] Confirm `pnpm-lock.yaml` is committed (supply-chain reproducibility).

**Gate:** no HIGH/CRITICAL findings. Every item in `docs/security/hardening-checklist.md` is checked by a human.

---

## Phase 3 — Documentation polish (week 2)

Goal: a fresh reader can go from landing page → first successful claim → integrated SDK in their project in < 30 minutes.

### 3.1 README
- [ ] Replace the placeholder `#` repo URL with the real one (and every other `#`).
- [ ] Add a "Live demo" link if you can host one, or remove that claim.
- [ ] Add one animated GIF or screenshot at the top (the claim UI in action).
- [ ] Confirm the docker one-liner in the Quick Start actually works from a clean machine.
- [ ] Add a badges row: CI, CodeQL, License, Image size, Latest version.
- [ ] Cross-link `AGENTS.md`, `SECURITY.md`, `CONTRIBUTING.md` (new in 3.2), `CHANGELOG.md`.

### 3.2 New files
- [ ] `CONTRIBUTING.md` — dev setup, turbo tasks, how to add a new abuse provider, how to add a new currency driver, coding conventions, commit style.
- [ ] `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1, verbatim, with a real contact in the enforcement section.
- [ ] `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md`.
- [ ] `.github/ISSUE_TEMPLATE/config.yml` — direct security reports to `SECURITY.md`, direct questions to Discussions.
- [ ] `FUNDING.yml` if applicable.

### 3.3 VitePress site (`apps/docs`)
- [ ] Fill every "TODO" marker (run `grep -rn TODO apps/docs/`).
- [ ] Replace the `faucet.nimiq.example` hostname in `config.mts` with the real docs domain (or remove the sitemap entry).
- [ ] Add screenshots to `guide/quick-start.md` (claim UI) and a dashboard screenshot to `guide/deployment.md`.
- [ ] Add a "When to use this vs. hosted Nimiq faucets" section to the homepage.
- [ ] Proofread every `integrations/*.md` — run each snippet in a scratch project; make sure it works.
- [ ] Link the hosted `/openapi.json` from `api/overview.md` once the demo is up.
- [ ] Add a versions dropdown (`themeConfig.nav`) — even if only `main` today, the structure should exist.

### 3.4 llms.txt and AGENTS.md
- [ ] Regenerate `/llms.txt` and `/llms-full.txt` from the actual endpoint inventory (not the hand-rolled version). Simple script in `tools/build-llms.ts`.
- [ ] Validate with an AI client: point Claude Code at the docs URL, ask it to add the faucet to a blank Next.js app, see if it succeeds. Iterate on the recipe until it does.
- [ ] Ensure every SDK ships its own `llms.txt` (spot-check).

### 3.5 In-code docs
- [ ] Every exported function in `@faucet/core` and `@nimiq-faucet/sdk` has a JSDoc with at least one example.
- [ ] Every `llms.txt` reflects the actual current surface (not the first draft).
- [ ] Run `typedoc` or `api-extractor` once; inspect the output for broken exports.

**Gate:** a new developer can clone, `docker run`, claim, and integrate the SDK from docs alone. Run this exercise with someone who hasn't seen the project.

---

## Phase 4 — UI polish (week 2–3)

Goal: both UIs look intentionally designed and work on mobile.

### 4.1 Claim UI (`apps/claim-ui`)
- [ ] Design pass: spacing, type scale, colour contrast (AA minimum) in both light and dark mode.
- [ ] Mobile viewport test (320 px – 430 px). Tap targets ≥ 44×44.
- [ ] Loading states for every async step (config fetch, hashcash solve, claim submit, confirmation).
- [ ] Error states for every failure mode: rate-limited (with retry-after), geo-blocked, VPN-blocked, captcha failed, WS disconnected, invalid address. Each has a friendly, actionable message — never a raw server string.
- [ ] Success state includes the tx hash as a copyable chip + a "View on block explorer" button that uses the verified explorer URL (kill the `TODO` in `apps/claim-ui/src/lib/explorer.ts`).
- [ ] Empty / disabled state: when the faucet balance is too low to payout, show "temporarily depleted" copy.
- [ ] Theme tokens: pull brand colours from a single `theme.ts` so integrators can re-skin easily.
- [ ] i18n stub filled in: audit that `src/i18n/en.ts` covers every user-visible string; no bare literals in templates.
- [ ] Screenshots: capture golden-path, hashcash-solving, rate-limited, success states. Add to docs.

### 4.2 Admin dashboard (`apps/dashboard`)
- [ ] Replace the hand-rolled QR fallback with a tiny dep if needed for reliability (accept a ~15 KB dep for `qrcode`).
- [ ] Sidebar: collapse / expand on mobile; overlay, not push.
- [ ] Overview cards: wire the streamed event types precisely (`claim.broadcast`, `claim.confirmed`, `admin.audit`); confirm the server emits those names (open question in the dashboard README).
- [ ] Claims table: pagination + sortable columns. Empty state.
- [ ] Claim drawer: pretty-print `signalsJson` with collapsible sections per layer; highlight contributing features from the AI layer.
- [ ] Blocklist: search + filter by kind.
- [ ] Integrators: once-shown secrets must force the operator to acknowledge they copied them (checkbox before continuing); copy buttons with "copied!" feedback.
- [ ] Account: rotate-key modal requires typing `ROTATE` literally (already present) AND re-entering TOTP — confirm this works.
- [ ] Config: show a diff between current and edited config; confirm with TOTP step-up for sensitive fields (deny thresholds, rate limits).
- [ ] Logs: auto-scroll toggle, pause-on-hover, export to CSV.
- [ ] Run the a11y spec with zero `serious`/`critical` violations; fix anything that surfaces.

### 4.3 Shared
- [ ] Consistent favicon (`apps/*/public/favicon.svg`).
- [ ] OG image + meta tags on both UIs.
- [ ] Production source maps uploaded somewhere private (for debugging) but not shipped in the Docker image.

**Gate:** both UIs pass axe-clean, work on a phone, and survive a design review.

---

## Phase 5 — Release readiness (week 3)

Goal: everything's pinned, named, and ready to publish.

### 5.1 Versioning
- [ ] Decide on starting version. Recommended: **`0.1.0`** — signals pre-1.0, explicit about scope.
- [ ] Bump every workspace package to `0.1.0` via `pnpm changeset` (record a "Initial public release" note).
- [ ] Pin every floating dep range to a minor (`^1.2` not `^1`).

### 5.2 Package publishing prep
- [ ] Decide the npm scope: **`@nimiq-faucet/*`** for public packages; keep `@faucet/*` internal workspace packages `"private": true`.
- [ ] Public packages to publish: `sdk`, `react`, `vue`, `capacitor`, `react-native`. Internal (don't publish): `core`, `driver-*`, `abuse-*`, `openapi`, `server`, `dashboard`, `claim-ui`, `docs`, `e2e`.
- [ ] Each public package has: correct `name`, `version`, `description`, `keywords`, `license`, `author`, `repository.url` (fill once the GH URL is known), `homepage`, `bugs.url`, `files` array limiting the tarball to `dist/`, `README.md`, and `llms.txt`.
- [ ] For the Go module: decide final path (`github.com/<org>/simple-faucet-go`) and add a separate repo OR a Go-module-ready subdirectory path.
- [ ] For Flutter: confirm `pub.dev` publishing requirements (topics, example, `CHANGELOG.md`).
- [ ] For Helm: confirm the OCI namespace (`oci://ghcr.io/<org>/charts`).

### 5.3 GHCR / registry placeholders
Replace every occurrence of `ghcr.io/nimiq/*` with the real namespace:
- [ ] `deploy/helm/values.yaml`
- [ ] `deploy/helm/README.md`
- [ ] `apps/docs/guide/quick-start.md`
- [ ] Root `README.md`
- [ ] `.github/workflows/release.yml`
- [ ] `.github/workflows/trivy.yml`

### 5.4 Workflow pre-flight
- [ ] `act -j build-and-publish` (or a throwaway tag `v0.1.0-rc1` pushed to a private fork) to verify the release pipeline produces a valid image + chart + SBOM.
- [ ] Confirm secrets exist in GitHub: `GITHUB_TOKEN` (automatic), `NPM_TOKEN`, `PUB_DEV_CREDENTIALS_JSON` (for Flutter), any `COSIGN_*` keys if you decide to sign.

### 5.5 Legal
- [ ] `LICENSE` contains the right year and copyright holder.
- [ ] All third-party code in the repo is MIT-compatible (spot-check every `llms.txt` for unusual licensing notes).
- [ ] Dual-license exception: `@nimiq/core` may have its own license terms — verify compatibility or document the dependency.
- [ ] Trademark: confirm "Nimiq" usage in the project name is acceptable to the Nimiq Foundation; seek permission or rename (`nimiq-community-faucet`?) before going public.

**Gate:** a fresh `git clone` of the branch, `pnpm install && pnpm build && pnpm test`, and `docker build`, all succeed on a clean machine with zero placeholder URLs.

---

## Phase 6 — Publish to a public repo (week 3–4)

Goal: first public release, announced.

### 6.1 Repo setup
- [ ] Create the public GitHub repo: `<org>/nimiq-simple-faucet` (name TBD — see 5.5 trademark note).
- [ ] Apply repo settings: require PR reviews, require signed commits (optional), require passing checks (CI + CodeQL + Trivy), dismiss stale reviews on new push.
- [ ] Protected branches: `main` only.
- [ ] Enable GitHub Discussions (Q&A category), Issues, Security Advisories, Dependabot alerts.
- [ ] Set repo topics: `nimiq`, `faucet`, `crypto-faucet`, `blockchain`, `payout`, `mcp-server`, `abuse-prevention`, `self-hosted`.
- [ ] Set default branch protection rules; require `Signed-off-by` if desired (DCO).
- [ ] Add branch ruleset: block direct push to `main`; require linear history.

### 6.2 First push
- [ ] One-shot squash: the current history is a 30-turn AI build session. Consider squashing to a single `initial public commit` (or a curated 5–10 commits that tell the story). This avoids publishing the messy back-and-forth.
- [ ] Verify `gitleaks` on the squashed history one more time.
- [ ] `git push origin main`.

### 6.3 First release
- [ ] `pnpm changeset version` → bumps every version + generates CHANGELOG.
- [ ] Merge the version PR.
- [ ] Tag `v0.1.0` and push.
- [ ] `release.yml` fires:
  - Multi-arch Docker image → `ghcr.io/<org>/simple-faucet:v0.1.0` and `:latest`.
  - npm packages published to `@nimiq-faucet/*`.
  - Helm chart → `oci://ghcr.io/<org>/charts/nimiq-simple-faucet:0.1.0`.
  - OpenAPI freeze PR against `packages/openapi/openapi.yaml`.
  - GH Release with CHANGELOG body.
- [ ] `sbom.yml` fires and attaches CycloneDX SBOMs to the release.
- [ ] Smoke test the published image: `docker run ghcr.io/<org>/simple-faucet:v0.1.0` from a clean machine.
- [ ] Smoke test one published SDK: in a scratch project, `pnpm add @nimiq-faucet/react`, wire a claim button, hit a hosted faucet, confirm it works.
- [ ] Smoke test the Helm chart in a scratch cluster (`kind` or `k3d`).

### 6.4 Docs site live
- [ ] Decide hosting: GitHub Pages (simple) vs. serve from the faucet itself vs. Cloudflare Pages. Recommended: GitHub Pages pinned to the latest tag.
- [ ] Publish `apps/docs/dist` to the chosen host.
- [ ] Verify every link resolves.
- [ ] Point `faucet.nimiq.example` (or whatever you use) DNS at it.

### 6.5 Announcement
- [ ] Pin an issue titled "Status: v0.1.0 initial public release — known limitations" with the items from `docs/release-polish-plan.md` (this file) that are still open at release time.
- [ ] Post to relevant forums: Nimiq community Discord / Telegram / forum, `/r/nimiq`, `/r/selfhosted` if you want reach.
- [ ] Add the repo to awesome-lists where appropriate (awesome-nimiq, awesome-selfhosted, awesome-mcp).

### 6.6 Post-release monitoring (week 4)
- [ ] Watch the first 48 h of issues for deployment / onboarding pain points; fix the most common ones in a `v0.1.1`.
- [ ] Confirm Dependabot is opening PRs on the schedule.
- [ ] Confirm CodeQL and Trivy run weekly.
- [ ] Watch npm download counts and image pull counts for the first week — sanity-check the release actually went out.

**Gate:** the faucet is running at a public URL, the docs are up, the image pulls, the SDKs install, and the first issue from an external user has been triaged.

---

## Not in scope for this polish pass

These are explicitly deferred to `v0.2`+:

- External third-party security audit.
- `POST /admin/config` live hot-reload (persisted but not applied until restart).
- Hot-swap of the faucet signing key after rotation.
- Per-layer weight sliders in the dashboard's abuse view.
- ONNX-backed AI scoring model (the rules engine ships; the ONNX hook is a future fit).
- Postgres migration path from SQLite.
- Multi-tenant mode (the architecture allows it; not wired for v0.1).
- Real-time translations (only `en` ships).

---

## Tracking

Use a single GitHub issue with 6 top-level checkboxes (one per phase) and 45 sub-tasks (the granular list above). Close each as it lands. The issue stays open until Phase 6 gate is passed.
