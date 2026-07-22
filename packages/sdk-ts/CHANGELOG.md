# @nimiq-faucet/sdk

## 2.4.0

### Minor Changes

- Automatic reward mode (server phases 1–4): baseline payout
  (`FAUCET_AUTOMATIC_REWARDS_ENABLED` / `FAUCET_AUTOMATIC_REWARDS_BASELINE_NIM`,
  #249), low-balance reward scaling (#252), identity-gated first-time
  claimant boost (#253), and identity-gated repeat-user reward reduction
  (#254) — all live-configurable from the admin dashboard. SDK republish
  keeps npm versions in lockstep with the Docker image / Helm chart; no
  SDK API changes. Security: hono floor >=4.12.25 (CVE-2026-54290),
  undici >=8.5.0 (CVE-2026-12151 / CVE-2026-9675), and the pnpm 11
  migration restores the CI audit gate via npm's bulk advisory endpoint.

## 2.3.1

### Patch Changes

- Maintenance + DX release.

  **Security:** 11 CVEs patched via `pnpm.overrides` and one direct devDep bump — turbo 2.9.10 → 2.9.14 (GHSA-hcf7-66rw-9f5r, GHSA-3qcw-2rhx-2726), brace-expansion ≥5.0.6 (GHSA-jxxr-4gwj-5jf2), ws ≥8.20.1 (GHSA-58qx-3vcg-4xpx), qs ≥6.15.2 (GHSA-q8mj-m7cp-5q26), axios ≥1.16.0 (HIGH: GHSA-pjwm-pj3p-43mv NO_PROXY bypass + GHSA-35jp-ww65-95wh MITM, and moderate GHSA-898c-q2cr-xwhg). uuid <11.1.1 (GHSA-w5hq-g745-h8pq) ignored with justification — only reachable via Expo CLI dev tooling.

  **§2.3.7 MCP integrator docs** — new [docs/mcp.md](https://github.com/PanoramicRum/nimiq-simple-faucet/blob/main/docs/mcp.md) enumerating the 3 public + 6 admin tools, auth model (session+TOTP step-up vs deprecated static token), client config snippets. `faucet.send`, `faucet.block_address`, and `faucet.unblock_address` input schemas now derive from the canonical REST Zod sources so the kind enum and length limits can't drift.

  **§2.3.8 Config reference** — new auto-generated [docs/config-reference.md](https://github.com/PanoramicRum/nimiq-simple-faucet/blob/main/docs/config-reference.md) covering all 74 `FAUCET_*` env vars with type, default, constraints, and JSDoc descriptions. Drift-checked by `pnpm pre-merge` plus a weekly GH Actions cron.

  **§2.3.9 Snippets cleanup** — dead `/snippets/<framework>` links in llms.txt + README redirected to the playground SDK pages; Python added to the framework list.

  **Dependency hygiene** — 8 dependabot bumps incl. RN 0.83→0.85, @types/node 22→25, vue/vue-router/better-sqlite3/ioredis/pg/undici patches, tailwind/vite/vitest/playwright dev-deps, all 4 GH Actions, and the Docker node base SHA. OpenAPI spec frozen for v2.3.0.

  No SDK source-code changes since v2.3.0 — this is purely a republish to keep the npm versions in lockstep with the Docker/Helm artifacts and to ship the CVE-patched transitives.
