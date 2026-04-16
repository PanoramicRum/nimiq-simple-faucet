# Hardening checklist

This checklist mirrors `docs/security/hardening-checklist.md` at the repo
root. Keep both in sync — the repo-root file is the source the security team
reviews pre-release; this page is what deployers read. Copy any subsection
into a PR comment or review thread.

## Transport + headers

- `@fastify/helmet` registered with strict CSP for `/admin`
  (`default-src 'self'`).
- Relaxed CSP for the public claim UI that still blocks inline scripts.
- `X-Frame-Options: DENY` / `frame-ancestors 'none'` on admin responses.
- `Referrer-Policy: no-referrer` on admin responses.
- `Permissions-Policy` denies `geolocation`, `microphone`, `camera`.
- TLS required in production; server refuses plain HTTP unless
  `FAUCET_DEV=1`.

## Session + CSRF

- Session cookie: `HttpOnly`, `Secure`, `SameSite=Strict`.
- 15-minute idle timeout + 8-hour absolute timeout.
- CSRF double-submit token on every `/admin/*` mutating route.
- TOTP step-up on `send`, `rotate-key`, integrator-secret rotation.
- Session store backed by SQLite (or configured DB), not in-memory only.

## Rate limiting + payload limits

- Global per-IP per-minute limit via `@fastify/rate-limit`.
- `/admin/auth/login` = 5/min/IP.
- `/v1/challenge` = 10/min/IP.
- Per-integrator limit overrides honoured from admin config.
- Payload size limits: admin JSON = 32 KiB, claim = 16 KiB.
- WebSocket message-rate cap on `/v1/stream`.

## CORS

- Strict per-integrator allow-list; `*` rejected in production.
- Preflight cache `max-age` set to a sensible default (e.g. 600s).
- Allowed headers explicitly enumerated (`x-faucet-*`, `content-type`).

## Auth + crypto

- Argon2id parameters: `memoryCost=64 MiB`, `timeCost=3`, `parallelism=4`.
- HMAC replay window: 5 minutes; nonce cache cleanup audited.
- All secret comparisons use `timingSafeEqual`.
- Admin password hashes stored with the per-install pepper (if enabled).
- TOTP secrets stored encrypted at rest.

## Signer key

- `FAUCET_KEY_PASSPHRASE` → Argon2id-derived 32-byte KEK.
- XChaCha20-Poly1305 envelope for `/data/faucet.key` (via `@noble/ciphers`).
- Key buffer zero-filled on rotation and on process exit.
- Key never appears in logs, errors, or HTTP responses.

## Error handling + logging

- No stack traces in production user-facing responses.
- Generic messages for every auth failure (`unauthorised`, not the cause).
- Log scrubber strips secrets, API keys, cookies, TOTP codes, HMAC
  signatures.
- Every denied claim logs signals to `audit_log`, not to request logs.
- Structured error IDs returned so support can cross-reference without
  exposing internals.

## Input validation

- Every route body validated by Zod at the boundary.
- Query strings validated the same way.
- `parseAddress` called before any address is persisted or sent.
- Uploaded files (if any) have an MIME + size allow-list.

## CI + supply chain

- CodeQL JavaScript/TypeScript on push + PR + weekly.
- Trivy on the built Docker image, fails on HIGH/CRITICAL.
- Gitleaks on push + PR.
- Dependabot on npm, GitHub Actions, Docker.
- `pnpm audit --prod` in CI with allow-list file.
- `eslint-plugin-security` + `eslint-plugin-no-secrets` baseline.
- SBOM generated (`cyclonedx-npm`) and attached to GitHub Release.

## Review gates (pre-merge)

- No secrets in the diff.
- New inputs validated at the boundary.
- New admin mutations route through `/admin/*`, not direct DB writes.
- New env vars added to `.env.example`.
- Timing-safe compare used wherever user input meets a secret.
- Threat-model note updated if a new component or trust boundary appears.
