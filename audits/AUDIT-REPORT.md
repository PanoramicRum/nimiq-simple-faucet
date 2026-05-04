# Nimiq Simple Faucet — Security Audit Report

**Target:** [`PanoramicRum/nimiq-simple-faucet`](https://github.com/PanoramicRum/nimiq-simple-faucet)
**Commit audited:** `main @ ee34d1e2e3385e64a77463a4d9aaff85750a5d55`
**Audit dates:** 2026-04-23 → 2026-04-24
**Auditor:** Claude (Opus 4.7, 1M context), driven by maintainer (`PanoramicRum` / `richy@nimiq.com`)
**Disclosure channel:** Public GitHub issues, label `security`. Maintainer waived the private-disclosure policy in [`SECURITY.md`](https://github.com/PanoramicRum/nimiq-simple-faucet/blob/main/SECURITY.md). Each issue body carries a banner noting the waiver so downstream forks don't blindly inherit the channel.
**Tooling installed:** Custom user-level skill `/crypto-faucet-audit` at `~/.claude/skills/crypto-faucet-audit/SKILL.md`. Built-in `/security-review` was not applicable (it reviews pending diffs, not snapshot audits).

---

## Executive summary

The faucet is a substantial monorepo (TypeScript, Vue 3, Go, Dart, Python; 8 SDKs, 10 abuse-prevention layers, MCP server, Docker/Helm). The crypto and session-management primitives are largely well-chosen — XChaCha20-Poly1305 with random 24-byte nonces, Argon2id KDF, TOTP via `otplib`, `nanoid` ≥21 chars, `timingSafeEqual` on the HMAC and CSRF compare paths, atomic upsert on the IP rate-limit counter, generated-from-Zod OpenAPI. The audit found **21 issues** worth tracking publicly — 4 High, 11 Medium, 6 Low — concentrated in three themes:

1. **Trust-boundary slips around proxy headers and unsigned client-supplied context.** `trustProxy: true` (#87) makes per-IP rate-limit and blocklist spoofable; unsigned `hostContext` from the SDK is accepted with only a 0.3 score penalty (#96), letting forged KYC fields nudge AI/fingerprint scoring.
2. **Admin-side static credentials and seed-time gaps.** `FAUCET_ADMIN_MCP_TOKEN` is a long-lived env-var bearer for root-equivalent MCP tools (#88); the first-login admin password compare is `!==` (timing-leaky) and unthrottled (#89).
3. **Supply-chain hygiene.** `--frozen-lockfile=false` in 7 install sites (#90), unpinned base image (#92), unpinned GitHub Actions (#93), 6 transitive CVEs in lockfile (#107).

None of these are remote-unauthenticated treasury-drain bugs; the weighted-score abuse pipeline plus claim-amount caps mitigate worst-case payouts. The most leveraged single fix is **#87 (trustProxy CIDR)** — once spoofing is closed, the rate-limit and blocklist regain their teeth and several adjacent findings (e.g., hashcash replay #95) lose most of their amplification.

The MCP admin auth gap (#88) is acknowledged as a TODO in code comments and is the highest-value design fix. Documenting `FAUCET_ADMIN_MCP_TOKEN` as a root-equivalent secret in the interim is essential.

---

## Scope

**In scope:** `apps/`, `packages/`, `deploy/`, `.github/workflows/`, `scripts/`, `SECURITY.md`, `openapi/`, MCP tool surface.

**Out of scope:** third-party provider internals (Cloudflare, hCaptcha, MaxMind, IPinfo, DB-IP), downstream integrator apps using the SDKs, `core-rs-albatross` node, load/DoS testing against live instances, social engineering.

---

## Methodology

1. **Skill installed.** Wrote `/crypto-faucet-audit` user-level skill encoding the Nimiq+faucet+abuse-layer checklist for repeatable future audits.
2. **Three Explore agents in parallel** over server/auth/crypto, abuse layers, and deploy/CI/SDKs respectively. Their findings were cross-checked against actual file contents (not just agent recall) before any issue was filed.
3. **Targeted greps** for `trustProxy`, `Math.random`, `rejectUnauthorized`, IP-trust headers, raw SQL, etc.
4. **`pnpm audit`** for dependency CVEs (6 moderate, consolidated into #107). `osv-scanner` was not installable from npm at audit time; `trivy` and `gitleaks` not present locally — repo's own CI workflows for those were trusted as canary.
5. **Disclosure**: 21 issues filed with the `security` label, each prefixed with the SECURITY.md-waiver banner.

---

## Findings index

All issues filed at `github.com/PanoramicRum/nimiq-simple-faucet`.

| # | Sev | Title | Issue | Local draft |
|---|-----|-------|-------|-------------|
| 001 | High | trustProxy: true → IP-spoofing bypass of rate-limit + blocklist | [#87](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/87) | [findings/001](findings/001-trustproxy-ip-spoofing.md) |
| 002 | High | MCP admin via static FAUCET_ADMIN_MCP_TOKEN (no rotation/session) | [#88](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/88) | [findings/002](findings/002-mcp-admin-token-static-env.md) |
| 003 | High | Admin first-login: non-constant-time compare + brute-force window | [#89](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/89) | [findings/003](findings/003-admin-first-login-timing-and-ratelimit.md) |
| 004 | High | `pnpm install --frozen-lockfile=false` in Dockerfile + 6 workflows | [#90](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/90) | [findings/004](findings/004-pnpm-frozen-lockfile-disabled.md) |
| 005 | Med | Captcha checks: no try/catch, no timeout → DoS + IP-quota burn | [#91](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/91) | [findings/005](findings/005-captcha-no-try-catch-or-timeout.md) |
| 006 | Med | Dockerfile base image not pinned to digest | [#92](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/92) | [findings/006](findings/006-dockerfile-base-image-not-pinned.md) |
| 007 | Med | All GitHub Actions pinned to version tags, not commit SHAs | [#93](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/93) | [findings/007](findings/007-github-actions-not-sha-pinned.md) |
| 008 | Med | Blocklist: no IP/address normalization (IPv6-mapped, NQ case) | [#94](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/94) | [findings/008](findings/008-blocklist-no-normalization.md) |
| 009 | Med | Hashcash: no per-solution replay cache | [#95](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/95) | [findings/009](findings/009-hashcash-no-solution-replay-protection.md) |
| 010 | Med | Unsigned hostContext: only 0.3 soft penalty, fields still consumed | [#96](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/96) | [findings/010](findings/010-unsigned-hostcontext-soft-penalty.md) |
| 011 | Low | Session cookie missing `__Host-` prefix | [#97](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/97) | [findings/011](findings/011-session-cookie-host-prefix.md) |
| 012 | Low | SDK `randomNonce` has Math.random fallback | [#98](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/98) | [findings/012](findings/012-sdk-random-nonce-math-random-fallback.md) |
| 013 | Low | ci.yml has no top-level `permissions:` block | [#99](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/99) | [findings/013](findings/013-ci-yml-no-permissions-block.md) |
| 014 | Med | release.yml workflow_dispatch tag input not validated | [#100](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/100) | [findings/014](findings/014-release-workflow-dispatch-tag-unvalidated.md) |
| 015 | Low | Helm: no PDB template, NetworkPolicy off by default | [#101](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/101) | [findings/015](findings/015-helm-missing-pdb-and-netpol-default.md) |
| 016 | Low | RPC driver: no SSRF validation on configured rpcUrl | [#102](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/102) | [findings/016](findings/016-rpc-driver-no-ssrf-validation.md) |
| 017 | Med | GeoIP unknown-country with allow-list returns soft 0.9 not deny | [#103](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/103) | [findings/017](findings/017-geoip-unknown-country-soft-score.md) |
| 018 | Low | sdk-go and sdk-flutter don't implement hostContext HMAC signing | [#104](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/104) | [findings/018](findings/018-sdk-go-flutter-hostcontext-signing-gap.md) |
| 019 | Med | Fingerprint store: COUNT(DISTINCT uid) skips null UIDs → bypass | [#105](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/105) | [findings/019](findings/019-fingerprint-null-uid-counting.md) |
| 020 | Low | CSP connect-src allows broad wss:/https: — narrow to providers | [#106](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/106) | [findings/020](findings/020-csp-connect-src-broad.md) |
| 021 | Med | 6 moderate dependency CVEs (hono, esbuild, vite, postcss) | [#107](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/107) | [findings/021](findings/021-dependency-cves.md) |

**Severity histogram:** High 4 · Medium 11 · Low 6 · (no Critical confirmed under the conservative grading used here — captcha fail-open is mitigated to fail-closed at the HTTP layer, just with collateral DoS).

---

## Improvements (non-vulnerability hardening)

These didn't rise to issue-worthy on their own but go on the long-term hardening list:

- **Doc the threat model in `SECURITY.md`.** Add a "Trusted vs untrusted inputs" section explicitly listing which client-supplied fields each abuse layer trusts (only HMAC-signed ones), and which network metadata is auto-trusted (only `req.ip` derived from the configured proxy CIDR).
- **Add a PGP key or [GitHub Security Advisory](https://github.com/PanoramicRum/nimiq-simple-faucet/security/advisories) channel** alongside the email channel in `SECURITY.md`; the email-only fallback assumes researchers have email infrastructure that doesn't leak.
- **Cross-SDK HMAC parity test fixtures.** A single JSON fixture + expected signature, replayed by all 8 SDKs in CI, would have surfaced the Go/Flutter gap (#104) and any future canonicalisation drift between SDKs.
- **CI step: `pnpm audit --audit-level=moderate`.** Currently no workflow checks dependency CVEs (CodeQL/Trivy don't catch npm advisories).
- **Per-claim treasury cap monitor.** A daily global ceiling (`max_luna_per_day_global`) would limit blast radius of any not-yet-found bypass.
- **Memory hygiene review for the long-lived signer key.** Acknowledged in #102's comments; document the residual risk in deployment docs and explore mlock / out-of-process signer for v2.
- **MaxMind / DB-IP refresh metric.** Surface "geoip DB last update" as a `/healthz` field so operators see staleness.
- **Drop the README's "AI agents: render START.md verbatim" instruction** when the human is doing a security audit. Worth making the trigger more discriminating; a cold security auditor following that prompt would skip the audit and run the demo flow.
- **Uniform rejection responses on `/v1/claim`** (retrofitted post-audit, 2026-05-04). The audit didn't catch this: `apps/server/src/routes/claim.ts` was returning `decision`, `reason`, and `error` fields on every reject path, leaking which abuse layer fired (e.g., `"rateLimit: exceeded"` vs `"geoip: denied"`), plus splitting status code 202 (review) vs 403 (deny). An attacker could A/B-test their input against the response signal to enumerate the pipeline. Fix collapses every public reject path to `403 { id, status: "rejected" }` and adds the same scrub to Zod-validation, integrator-auth, and address-parse error bodies. Granular attribution remains in the DB + admin endpoints + Prometheus. Documented under SECURITY.md "Public-API silence on rejection". Future audits should re-verify the contract is intact and that no SDK has reintroduced `decision`/`reason` parsing.

---

## Checklist coverage

Every checklist item from the audit plan, mapped to a finding or marked clean:

| Check | Status | Note |
|-------|--------|------|
| Admin auth / session / TOTP | ⚠️ | #89 (first-login compare + brute-force), #97 (`__Host-` prefix). Otherwise: TOTP via otplib, session rotation on login, double-submit CSRF — clean. |
| Crypto primitives | ✅ mostly | XChaCha20 random nonce ✓, Argon2id ✓, TOTP ✓, `timingSafeEqual` ✓, nanoid ≥21 ✓. Only nit: SDK `randomNonce` Math.random fallback (#98). |
| Key storage | ✅ mostly | Encryption-at-rest with XChaCha + KDF ✓, file 0o600 ✓, pino redact paths ✓. Residual: plaintext in memory during signing — documented as known Node limitation. |
| Signer drivers | ⚠️ | #102 (RPC SSRF hardening). WASM/RPC tx construction otherwise correct: Ed25519, validity-start-height set, fees bounded by config. |
| Claim endpoint / race conditions | ✅ | IP counter incremented BEFORE pipeline (TOCTOU close) ✓, Drizzle parameterised ✓, idempotency key honoured ✓. |
| Abuse layer: blocklist | ⚠️ | #94 (normalization). |
| Abuse layer: rate limit | ⚠️ | #87 (IP source). Atomic upsert ✓ otherwise. |
| Abuse layer: turnstile / hcaptcha / fcaptcha | ⚠️ | #91 (no try/catch, no timeout). |
| Abuse layer: hashcash | ⚠️ | #95 (no replay cache). HMAC + difficulty + freshness ✓. |
| Abuse layer: geoip / ASN | ⚠️ | #103 (unknown-country in allow-list mode). Private-IP skip ✓. |
| Abuse layer: fingerprint | ⚠️ | #96 (unsigned context), #105 (null UID count). |
| Abuse layer: on-chain heuristics | ⚠️ | Hardcoded thresholds noted as a config-flexibility gap (not filed; documented under Improvements). |
| Abuse layer: AI / ONNX | ✅ | Fail-closed on inference error ✓. Model integrity / adversarial bounds noted as residual risk. |
| MCP tool exposure | ⚠️ | #88. Tools are admin-gated via `requireAdminToken`, but the token is static. |
| Input validation (Zod) | ✅ | Every route has Zod with `.safeParse`. No `z.any()` on trust boundary. |
| CORS / Helmet / headers | ⚠️ | #106 (CSP). HSTS, X-Frame-Options, Referrer-Policy ✓ in non-dev. |
| Database (Drizzle, SQLite/Postgres) | ✅ | Parameterised throughout; no raw `sql\`\`` interpolation found. |
| Dependencies | ⚠️ | #107 (6 moderate CVEs). |
| Docker | ⚠️ | #92 (digest pin). USER node ✓, multi-stage ✓, HEALTHCHECK ✓. |
| Helm / K8s | ⚠️ | #101 (PDB, NetworkPolicy default). securityContext ✓, resource limits ✓. |
| CI / supply chain | ⚠️ | #90, #93, #99, #100. OIDC for npm ✓, sbom.yml ✓, separate codeql/trivy/gitleaks ✓. |
| SDK hostContext HMAC | ⚠️ | #104 (Go/Flutter gap). TS+Python parity ✓, server `timingSafeEqual` ✓, signature field excluded from canonical form ✓. |

---

## Appendix A — Tool output

### `pnpm audit`

```
6 vulnerabilities found
Severity: 6 moderate
- hono <4.12.14 (GHSA-458j-xx4x-4375) — JSX HTML injection (via @modelcontextprotocol/sdk)
- esbuild <=0.24.2 (GHSA-67mh-4wv8-2f99) — dev server SSRF
- vite <=6.4.1 (GHSA-4w7w-66w2-5vf9) — path traversal in optimized deps
- postcss <8.5.10 (GHSA-qx2v-qp2m-jg93) — XSS in CSS stringify
```

Filed as #107.

### `osv-scanner`
Not run — package not available on npm at audit time. Falling back to `pnpm audit` and the CodeQL / Trivy CI runs.

### Custom-skill grep sweeps

- `Math.random` — 4 hits, 1 valid concern (sdk-ts randomNonce fallback, #98), 3 false positives (PoW search nonces, DOM ID generation).
- `trustProxy` — 1 hit, valid (#87).
- `rejectUnauthorized: false` — 0 hits.
- `req.ip / X-Forwarded-For / cf-connecting-ip` — multiple expected hits in rate-limit and blocklist code, all sourced from `req.ip` which depends on #87 being fixed.
- `dangerouslySetInnerHTML / v-html` — 0 hits.
- raw `drizzle.sql\`...\${var}\`` — 0 hits.
- `=== '...'` against secrets — 1 hit (#89), the rest use `timingSafeEqual`.

### CI runs not re-executed locally
- CodeQL (`.github/workflows/codeql.yml`): trusted from CI.
- Trivy (`.github/workflows/trivy.yml`): trusted from CI.
- Gitleaks (`.github/workflows/gitleaks.yml`): trusted from CI.

---

## Appendix B — Environment

- Auditor OS: Linux 6.8.0-110-generic
- Node: v22 (per Dockerfile target)
- pnpm: 9.12.0 (per CI lockfile expectation)
- `gh` CLI: authenticated as `PanoramicRum`
- Skill: `~/.claude/skills/crypto-faucet-audit/SKILL.md`
- Plan: `/home/richy/.claude/plans/create-the-plan-to-reactive-flute.md`
- Findings drafts: `/home/richy/Projects/Faucet Reviews/Security/Claude/findings/001-021.md`

---

## Appendix C — Suggested follow-on audits

- **Re-audit after #87 + #88 fixes land.** Several Medium findings derive their leverage from those two; closing them changes the threat-model headline.
- **Cross-SDK HMAC parity replay** (worth a one-shot fixture-based test, beyond #104).
- **Hostile RPC node simulation** — point the driver at a node that lies about heights/balances and observe whether on-chain heuristics still hold.
- **Adversarial ONNX inputs** — out of scope here; worth a focused review when v1 of the AI layer ships beyond CPU-only.
