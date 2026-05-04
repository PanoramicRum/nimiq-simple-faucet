# Nimiq Simple Faucet — Security Re-Audit (Second Edition)

**Target:** [`PanoramicRum/nimiq-simple-faucet`](https://github.com/PanoramicRum/nimiq-simple-faucet)
**Commit audited:** `main @ 855868a` (2026-05-04)
**Audit dates:** 2026-05-04
**Auditor:** Claude (Opus 4.7, 1M context), driven by maintainer (`PanoramicRum` / `richy@nimiq.com`)
**Predecessor:** [`AUDIT-REPORT.md`](AUDIT-REPORT.md) — 21 findings (#87–#107) at `main @ ee34d1e` on 2026-04-23, all merged via #108–#134 by 2026-04-25
**Disclosure channel:** Public GitHub issues with `security` label per the SECURITY.md waiver. Each issue body carries the inheritable-disclosure-warning banner. **Findings in this report have been drafted but NOT YET FILED** — maintainer wanted to review before publishing.
**Tooling:** [`~/.claude/skills/crypto-faucet-audit/SKILL.md`](~/.claude/skills/crypto-faucet-audit/SKILL.md) (same skill as the original audit)

---

## Executive summary

Re-audit of the faucet 11 days after the original 21-finding audit closed and the post-audit feature work (53 commits) landed. The headline result: **7 new findings, all Medium or Low, no Critical or High**. Three of the seven (022, 023, 024) directly contradict the [`SECURITY.md` "Public-API silence on rejection"](../SECURITY.md) contract introduced in PR [#176](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/176) — the same contract that motivated this audit cycle. Four others are smaller hardening items.

**Severity histogram:** Medium ×3 · Low ×4 · (no Critical or High; no fixed findings regressed)

The contract-contradiction trio (022/023/024) is the most actionable. PR #176 closed `POST /v1/claim` and `GET /v1/claim/:id` against abuse-layer attribution leakage, but three sibling public endpoints surface the same data:
- `/v1/stats/summary` returns `topRejectionReasons` strings AND per-row `decision`/`rejectionReason` in `recentClaims`/`recentBlocked`
- `/v1/claims/recent` exposes `decision` + `rejectionReason` per row (and the section comment misleadingly says "no sensitive fields")
- The pipeline still short-circuits on `deny`, leaking layer-position via response timing — defeating body uniformity for any attacker who measures wall-clock

The trio's combined fix is small (~30 lines of route-handler diff plus a pipeline strategy decision) and ships as one PR. After it lands, the `SECURITY.md` contract is materially stronger.

The remaining four findings (025-028) are individually-Low hardening items; each independent.

**No regression** of the original 21 findings (#87–#107). The major dep bumps (TS 5.9 → 6, zod 3 → 4, vitest 2 → 4, react 18 → 19) introduced no security regressions in critical paths — Zod 4's stricter discriminator inference holds; TS 6 type-narrowing changes don't weaken the trust-boundary guards.

---

## Scope

**In scope:** `apps/`, `packages/`, `deploy/`, `.github/workflows/`, `scripts/`, `SECURITY.md`, `openapi/`, MCP tool surface, and specifically the new code surface added since 2026-04-23 (theme registry, Hub-API wallet connect, FCaptcha URL split, sdk-capacitor, CORS wildcard, MCP session-vs-static-token migration, rejection-uniformity contract).

**Out of scope:** unchanged from the original audit — third-party provider internals (Cloudflare, hCaptcha, MaxMind, IPinfo, DB-IP, FCaptcha), downstream integrator apps using the SDKs, `core-rs-albatross` node, load/DoS testing against live instances, social engineering, abuse-AI ONNX adversarial bounds.

---

## Methodology

1. Three Explore agents in parallel covering distinct slices: (A) new code surface, (B) rejection-uniformity contract verification, (C) regression check on #87–#107 + dep-bump implications.
2. Every candidate finding cross-checked against the actual code (Read tool), not just agent recall. Two agent-flagged candidates (path-traversal in `ui.ts`, CORS wildcard regex) were retired after cross-check — not exploitable on Linux given existing guards.
3. Disclosure model: public issues for Medium/Low (no Critical/High required GHSA private path); banner inherited from the original audit.
4. Drafts produced under [`audits/findings-2026-05/`](findings-2026-05/) per the skill template (one finding per markdown file, full issue-body shape).

---

## Findings index

All findings are draft markdown under [`audits/findings-2026-05/`](findings-2026-05/). They have NOT been filed as issues yet — pending maintainer review.

| # | Sev | Title | Issue (TBD) | Local draft |
|---|-----|-------|------|-------------|
| 022 | Med | `/v1/stats/summary` leaks abuse-layer attribution despite #176 | TBD | [022](findings-2026-05/022-stats-summary-leaks-rejection-attribution.md) |
| 023 | Med | `/v1/claims/recent` exposes decision + rejectionReason per row | TBD | [023](findings-2026-05/023-claims-recent-leaks-decision-and-reason.md) |
| 024 | Med | Pipeline short-circuits on hard `deny` — timing side-channel attribution | TBD | [024](findings-2026-05/024-pipeline-short-circuit-timing-attribution.md) |
| 025 | Low | `/v1/stats` `byDecision` aggregate counts publicly exposed | TBD | [025](findings-2026-05/025-stats-byDecision-aggregate-leak.md) |
| 026 | Low | Cross-theme asset probe serves any bundled theme's `dist/` | TBD | [026](findings-2026-05/026-cross-theme-asset-probe-leakage.md) |
| 027 | Low | `adminMcpAllowStaticToken` defaults to `true` indefinitely; no expiry | TBD | [027](findings-2026-05/027-mcp-static-token-default-true-no-expiry.md) |
| 028 | Low | sdk-capacitor injects `visitorId` without HMAC signing — parity gap with closed #104 | TBD | [028](findings-2026-05/028-sdk-capacitor-fingerprint-not-signed.md) |

---

## Suggested fix bundling

Three logical PRs cover all 7 findings:

### PR 1 — Public-API rejection silence on stats/recent endpoints (022 + 023 + 025)
- `apps/server/src/routes/claim.ts` L411-426 (`/v1/stats`): drop `byDecision` from public response; drop `decision` from SELECT
- `apps/server/src/routes/claim.ts` L432-518 (`/v1/stats/summary`): drop `topRejectionReasons` from public response; drop `decision` and `rejectionReason` from `recentClaims` and `recentBlocked` row shapes
- `apps/server/src/routes/claim.ts` L520-555 (`/v1/claims/recent`): drop `decision` and `rejectionReason` from row shape; fix the "no sensitive fields" comment
- New admin equivalents under `/v1/admin/*` if operator dashboards need the granular shape (most likely they already use `/v1/admin/claims`)
- Update the `claim-rejection-uniformity.e2e.test.ts` (or add a new uniformity test) to cover stats/recent endpoints
- One-paragraph addition to [`SECURITY.md` "Public-API silence on rejection"](../SECURITY.md) noting that the contract applies to *every* public read, not just claim-status

### PR 2 — Constant-time reject delivery (024)
- `apps/server/src/routes/claim.ts`: pad every public reject (deny, review, Zod-invalid, integrator-auth-failed, invalid-address) to a configurable `T_min` (default 1500ms) using server-side `setTimeout`
- Don't change `packages/core/src/pipeline.ts` — short-circuit-on-deny is fine internally; the padding lives at the route layer where the response timing actually matters
- New env: `FAUCET_REJECT_DELAY_MS_MIN` (default 1500). Document it in the production-deployment guide.
- New test that verifies `process.hrtime` between request and response is ≥ T_min for each reject path

### PR 3 — Hardening (026 + 027 + 028)
- `apps/server/src/ui.ts`: only probe the *requested* theme's `dist/` in the SPA fallback (drop the cross-theme loop)
- `apps/server/src/config.ts`: emit boot-time `WARN` when `adminMcpAllowStaticToken=true` AND `adminMcpToken` is set; flip `default(true)` → `default(false)` in the next minor (release-notes-driven decision)
- `packages/sdk-capacitor/`: add JSDoc + README warning that `visitorId` is unsigned client input; document the integrator-backend signing pattern
- These three are independent and can ship in any order

---

## Regression matrix — original audit findings #87–#107

All 21 findings remain in their fixed state. No regression detected.

| # | Title | Fix verified at | Status |
|---|-------|-----------------|--------|
| 87 | trustProxy CIDR | `apps/server/src/app.ts:54` | still-fixed |
| 88 | MCP static token | `apps/server/src/mcp/index.ts` (session-path preferred); BUT default is permissive — see finding 027 | still-fixed (with hygiene gap) |
| 89 | Admin first-login compare + brute-force | `apps/server/src/routes/admin/auth.ts:54-59` `safeEqualUtf8` + 5 req/min limit | still-fixed |
| 90 | `--frozen-lockfile=false` | Dockerfile + 6 workflows enforce `--frozen-lockfile` | still-fixed |
| 91 | Captcha try/catch + timeout | `apps/server/src/abuse/turnstile.ts:41-64` (and parity in hcaptcha/fcaptcha) | still-fixed |
| 92 | Dockerfile base image digest | `deploy/docker/Dockerfile:1` SHA-pinned | still-fixed |
| 93 | GH Actions SHA-pinned | `.github/workflows/*.yml` audited | still-fixed |
| 94 | Blocklist normalization | `apps/server/src/abuse/blocklist.ts:22` `normalizeBlocklistValue()` | still-fixed |
| 95 | Hashcash replay cache | `packages/abuse-hashcash/src/index.ts:26-70` `HashcashReplayStore` | still-fixed |
| 96 | Unsigned hostContext stripping | `apps/server/src/routes/claim.ts:236` `stripUnsignedHostContext()` before pipeline | still-fixed |
| 97 | Cookie `__Host-` prefix | `apps/server/src/auth/middleware.ts:40` | still-fixed |
| 98 | sdk-ts randomNonce Math.random fallback | `packages/sdk-ts/src/index.ts:328-341` WebCrypto only | still-fixed |
| 99 | ci.yml `permissions:` block | `.github/workflows/ci.yml` top-level | still-fixed |
| 100 | release.yml tag validation | semver pattern | still-fixed |
| 101 | Helm PDB + NetworkPolicy | `deploy/helm/` templates | still-fixed |
| 102 | RPC SSRF validation | `packages/driver-nimiq-rpc/` validates rpcUrl | still-fixed |
| 103 | GeoIP unknown-country | hard-deny in allow-list mode | still-fixed |
| 104 | SDK hostContext HMAC parity | sdk-go + sdk-flutter signed; **but** sdk-capacitor regressed — see finding 028 | still-fixed (with new instance) |
| 105 | Fingerprint null-UID counting | `apps/server/src/abuse/fingerprint.ts` excludes null | still-fixed |
| 106 | CSP connect-src narrowed | `apps/server/src/hardening.ts:64-71` provider-specific | still-fixed |
| 107 | 6 transitive CVEs | `package.json:54-60` overrides + post-bump verification | still-addressed |

Two findings have new "instances" (different code path, same class): **#88 → finding 027** (default-permissive flag) and **#104 → finding 028** (sdk-capacitor unsigned visitorId). Treat as fresh findings, not regressions.

---

## Improvements (non-vulnerability hardening)

Below the issue-worthy threshold but on the long-term hardening list:

- **Cross-SDK uniformity test fixture.** A single JSON fixture replayed by every SDK in CI would catch any future regression of #176's body shape (and would have caught the SDK side of finding 028 mechanically).
- **Boot-time security-flag audit.** A startup helper that scans the resolved config for known footguns (`adminMcpAllowStaticToken=true`, `requireBrowser=false` outside dev, `corsOrigins='*'` outside dev) and emits a single consolidated `WARN` line. Reduces the number of "comments promised; nobody flipped the default" classes (finding 027).
- **`SECURITY.md` "Public-API silence on rejection" expansion.** The current section narrowly covers the claim endpoint. After the PR 1 fix (findings 022 + 023 + 025), expand it to cover the contract for all public reads: "Aggregate or recent-row endpoints must NOT carry per-claim `decision` or `rejectionReason`."
- **Per-claim treasury cap monitor.** Same as the original audit's improvements list. A daily global ceiling (`max_luna_per_day_global`) would limit blast radius of any not-yet-found bypass; with the new MCP `send` tool, this becomes more relevant.
- **Document the rejection-timing contract once PR 2 lands.** Add a doc page or `SECURITY.md` subsection "Constant-time reject delivery" describing `T_min` and how to tune it.

---

## Checklist coverage

| Check | Status | Note |
|-------|--------|------|
| Admin auth / session / TOTP | ✅ | All audit fixes intact; finding 027 is hygiene, not auth bypass |
| Crypto primitives | ✅ | XChaCha20 random nonce, Argon2id, TOTP via @otplib/preset-default (umbrella `otplib` removed in #172), `timingSafeEqual` everywhere — clean |
| Key storage | ✅ | Unchanged from original audit; passphrase + XChaCha unchanged |
| Signer drivers | ✅ | RPC SSRF guard (#102) intact; WASM driver unchanged |
| Claim endpoint / race conditions | ✅ | IP counter pre-pipeline (TOCTOU close) intact; uniform reject body new in #176 |
| Public read endpoints (NEW) | ⚠️ | Findings 022, 023, 025 — `/v1/stats`, `/v1/stats/summary`, `/v1/claims/recent` leak |
| Rejection-response timing (NEW) | ⚠️ | Finding 024 — pipeline short-circuit |
| Theme registry / asset routing (NEW) | ⚠️ | Finding 026 — cross-theme probe |
| Abuse layer: blocklist | ✅ | Fix #94 intact |
| Abuse layer: rate limit | ✅ | Fix #87 intact (CIDR-based trust) |
| Abuse layer: captcha | ✅ | Fix #91 intact; FCaptcha provider new but follows the same try/catch + timeout shape |
| Abuse layer: hashcash | ✅ | Fix #95 intact |
| Abuse layer: geoip / ASN | ✅ | Fix #103 intact |
| Abuse layer: fingerprint | ✅ | Fix #105 intact; finding 028 is SDK-side |
| Abuse layer: on-chain heuristics | ✅ | Unchanged |
| Abuse layer: AI / ONNX | ✅ | Unchanged; fail-closed on inference error |
| MCP tool exposure | ⚠️ | Session+TOTP path correct; finding 027 (default-permissive flag) |
| Input validation (Zod) | ✅ | zod 4 migration audited; no schema loosened |
| CORS / Helmet / headers | ✅ | Wildcard regex anchored; CSP unchanged |
| Database (Drizzle, SQLite/Postgres) | ✅ | No raw SQL interpolation found |
| Dependencies | ✅ | No new moderate+ CVEs introduced by zod 4 / TS 6 / vitest 4 / react 19 |
| Docker | ✅ | Multi-theme bundling didn't introduce new surface |
| Helm / K8s | ✅ | Unchanged |
| CI / supply chain | ✅ | All audit fixes intact |
| SDK hostContext HMAC | ⚠️ | sdk-go + sdk-flutter intact; sdk-capacitor regressed → finding 028 |

---

## Appendix A — Tool output

### `pnpm audit --audit-level=moderate`

(Run inline during the audit; current state matches package.json overrides — no NEW moderate+ CVEs introduced by the post-#107 dep bumps. The pre-existing dev-only ignored CVEs in `package.json:54-60` are unchanged.)

### Custom-skill grep sweeps (per Appendix A of the original audit)

| Sweep | Original audit | This audit | Verdict |
|---|---|---|---|
| `Math.random` | 4 hits, 1 valid (#98) | 4 hits, 0 valid | clean — fix #134 holds |
| `trustProxy` | 1 hit, valid (#87) | 1 hit, fixed | clean |
| `rejectUnauthorized: false` | 0 | 0 | clean |
| `=== '...'` against secrets | 1 hit (#89) | 0 — `timingSafeEqual` everywhere | clean |
| `dangerouslySetInnerHTML` / `v-html` | 0 | 0 | clean |
| Raw `drizzle.sql\`...\${var}\`` | 0 | 0 | clean |
| New: `decision: claims.decision` in public route | n/a | **3 hits** (#411-426, #480-498, #537-539) | findings 022, 023, 025 |
| New: `rejectionReason: claims.rejectionReason` in public route | n/a | **2 hits** (#481, #539) | findings 022, 023 |

### CI runs not re-executed locally

- CodeQL, Trivy, Gitleaks: trusted from CI (same as original audit).

---

## Appendix B — Environment

- Auditor OS: Linux 6.8.0-110-generic
- Node: v22 (per Dockerfile target)
- pnpm: 9.15.5 (current local; 10.33.2 update available, untaken)
- `gh` CLI: authenticated as `PanoramicRum`
- Skill: `~/.claude/skills/crypto-faucet-audit/SKILL.md` (unchanged from original audit)
- Plan: `/home/richy/.claude/plans/look-athe-last-session-dreamy-fog.md`
- Findings drafts: `audits/findings-2026-05/022-028.md` (this directory)

---

## Appendix C — Suggested follow-on audits

- **Re-audit after PR 1 + PR 2 land.** The contract-contradiction trio (022/023/024) has a single coherent fix bundle; once it merges, re-verify by spot-checking the new admin endpoints and the timing harness.
- **Mini-app real-phone audit.** `INTEGRATION_NOTES.md` has an open `Origin`-header empirical test (#121) that requires phone-in-hand. Out of scope here, still pending.
- **Operator-dashboard view of the granular fields after PR 1.** When granular `decision`/`rejectionReason` move behind admin auth, audit the admin claims-list rendering for any client-side caching that might leak to a non-admin tab.
- **Adversarial ONNX inputs.** Same as the original audit's recommendation; still on the list.

---

## Appendix D — Skill update suggestions

Append to [`~/.claude/skills/crypto-faucet-audit/SKILL.md`](~/.claude/skills/crypto-faucet-audit/SKILL.md) (deferred — propose to the user):

1. **Section "Public-read endpoints"**: a checklist item for "any aggregate or recent-rows endpoint must not carry per-row `decision` / `rejectionReason` / `signalsJson` fields." Findings 022/023/025 would have been auto-flagged.
2. **Section "Rejection timing"**: a checklist item for "pipelines that aggregate decisions must not short-circuit if response uniformity is part of the threat model — pad at the route layer." Finding 024 would have been auto-flagged.
3. **Section "Cross-SDK parity"**: when a new SDK (e.g., sdk-capacitor, sdk-react-native) lands, run the cross-SDK HMAC-parity sweep that #104's fix established. Finding 028 would have been auto-flagged.

Don't apply these changes to the skill yet — wait for maintainer sign-off on this audit.
