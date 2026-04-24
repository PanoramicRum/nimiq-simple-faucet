# OWASP Top 10 (2021) mapping

One row per category. "Tracked in" points at the plan milestone where the
remaining work is scheduled.

| Category | How we address it | Remaining gaps | Tracked in |
| --- | --- | --- | --- |
| A01 Broken Access Control | `/admin/*` routes live behind session cookie + TOTP; integrator API under HMAC + per-key `integratorId`; claim route has no admin code path; session cookies are `HttpOnly` / `Secure` / `SameSite=Strict` | Session auth + TOTP not yet implemented; CSRF double-submit pending | M3.1, M6.2 |
| A02 Cryptographic Failures | HMAC-SHA256 for integrator requests; `timingSafeEqual` compares; Argon2id for admin password; XChaCha20-Poly1305 for signer key blob; TLS enforced in prod | Key-encryption-at-rest still planned; signer not yet wrapped | M3.3, M6.2 |
| A03 Injection | Fastify + Zod body validation (`ClaimBody`, `HostContextSchema`); Drizzle ORM parameterises all SQL; address parsed via driver `parseAddress` before any DB write | ESLint `eslint-plugin-security` baseline not yet wired; fuzz pass on `POST /v1/claim` pending | M6.1, M6.4 |
| A04 Insecure Design | Abuse pipeline is layered (blocklist, rate-limit, captcha, hashcash, geoip) with fail-soft on third-party outages; signer is never reachable from the public surface; per-integrator secrets rotatable | Abuse-AI + on-chain heuristics not yet shipped; threat-model sign-off outstanding | M2.2, M2.3, M6.4 |
| A05 Security Misconfiguration | Strict TS + `exactOptionalPropertyTypes`; strict CORS allow-list; `bodyLimit` set at app level; production refuses plain HTTP unless `FAUCET_DEV=1` (planned) | `@fastify/helmet` + CSP not yet registered; per-endpoint rate limits (`/admin/auth/login`, `/v1/challenge`) planned | M6.2 |
| A06 Vulnerable and Outdated Components | Dependabot on npm, GitHub Actions, and Docker; Trivy scan on the built image (HIGH/CRITICAL fails CI); CodeQL on push + PR; `pnpm audit --prod` with allow-list (planned) | SBOM generation on release pending | M6.1, M9 |
| A07 Identification and Authentication Failures | TOTP on admin login and sensitive admin mutations; Argon2id with OWASP-recommended parameters; per-endpoint login rate limit (5/min/IP); generic auth error messages | Session-store + lockout policy ships with M3.1 | M3.1, M6.2 |
| A08 Software and Data Integrity Failures | `pnpm --frozen-lockfile=false` today but lockfile committed; release images will ship with SBOM attached; Docker image built reproducibly via multi-stage Dockerfile | Release signing (cosign) and SLSA provenance not yet wired | M9 |
| A09 Security Logging and Monitoring Failures | Every claim row persists signals + decision + score; audit log table for admin actions; live `admin.audit` stream via WS; log scrubber forbids secrets | Audit log + WS stream implemented in M3.4; structured error IDs for support flow pending | M3.4, M6.2 |
| A10 Server-Side Request Forgery | Only outbound traffic is: captcha verify endpoints (fixed hostnames for Turnstile/hCaptcha; operator-configured URL for self-hosted FCaptcha), GeoIP provider (fixed hostname or local MMDB file), configured Nimiq RPC node; no user-supplied URLs in server code paths | Confirm no future admin feature forwards operator URLs without an allow-list | M6.4 |

## Per-endpoint cross-reference

| Endpoint | Primary categories | Key mitigations |
| --- | --- | --- |
| `POST /v1/claim` | A01, A03, A04, A05 | Zod body, rate-limit, captcha/hashcash, integrator HMAC with timing-safe compare |
| `POST /v1/challenge` | A04, A05 | Per-IP rate-limit (planned 10/min), hashcash secret never leaves server |
| `GET /v1/config` | A05 | Returns site-keys only (never secrets) |
| `GET /v1/stats` | A05, A09 | Aggregates over last 100 rows; no PII surfaced |
| `WS /v1/stream` | A01, A05 | Broadcast-only; no admin events on this channel |
| `/admin/*` (planned) | A01, A02, A07, A09 | Session cookie + TOTP, CSRF double-submit, audit log, Helmet/CSP |
