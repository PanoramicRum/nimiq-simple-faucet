# Threat model (STRIDE)

Scope: the server, abuse pipeline, signer key handling, currency drivers,
and the two UIs. Each table row is a STRIDE category and the mitigation in
this repo (shipped unless marked **planned**).

## Data flow (ASCII)

```
                 +----------------------+
                 |   Public claim UI    |  apps/claim-ui  (Vue 3, CSP planned)
                 +----------+-----------+
                            | HTTPS
                            v
+--------------------+  POST /v1/claim   +---------------------------+
|  Integrator app    +------------------>+        Fastify server      |
|  (signs hostCtx    |  x-faucet-*       |    apps/server/src/app.ts  |
|   with HMAC)       |  headers          +------+---------------+-----+
+--------------------+                          |               |
                                                v               v
                                        +----------------+  +-----------------+
                                        | Abuse pipeline |  |  CurrencyDriver |
                                        | packages/core  |  |  (Nimiq RPC /    |
                                        | + abuse-*      |  |   WASM)          |
                                        +-------+--------+  +--------+--------+
                                                |                    |
                                                v                    v
                                        +----------------+    +--------------+
                                        |  SQLite / PG   |    |  Nimiq node  |
                                        |  claims, nonces|    |  (RPC /       |
                                        |  blocklist     |    |   consensus)  |
                                        +----------------+    +--------------+

                 +----------------------+
                 |   Admin dashboard    |  apps/dashboard  (session cookie + TOTP)
                 +----------+-----------+
                            | HTTPS (/admin/*, CSRF double-submit)
                            v
                     Fastify admin routes
                            |
                            v
                  +---------------------+
                  |  faucet.key (disk)  |  argon2id + XChaCha20-Poly1305 (planned)
                  +---------------------+
```

## Components

### Public claim endpoint — `POST /v1/claim`

| STRIDE | Threat | Mitigation |
| --- | --- | --- |
| Spoofing | Bots pretending to be humans | Cloudflare Turnstile / hCaptcha / self-hosted FCaptcha; hashcash fallback; per-integrator HMAC when `x-faucet-api-key` is present |
| Tampering | Malformed / overlong bodies | Zod schema (`ClaimBody`), `bodyLimit: 64 KiB` at Fastify layer, `parseAddress` strict |
| Repudiation | Operator cannot prove a claim decision | Every claim row persists `signalsJson`, `decision`, `abuseScore`; audit log (planned M3.4) adds admin overrides |
| Info disclosure | Leaking why a claim was denied to abusers | Public response returns only the first reason; full signals are admin-only via `/admin/claims/:id/explain` |
| Denial of service | Flooding the endpoint | `@fastify/rate-limit` per-IP (minute), per-IP per-day counter in DB, hashcash raises attacker cost |
| Elevation of privilege | Public caller touching admin data | Claim route has no code path to admin tables or signer key; admin routes live under `/admin/*` only |

### Integrator API (HMAC-signed requests)

| STRIDE | Threat | Mitigation |
| --- | --- | --- |
| Spoofing | Forged signatures | `createHmac('sha256', secret)` over `METHOD\nPATH\nTS\nNONCE\nBODY`, `timingSafeEqual` compare (`apps/server/src/hmac.ts`) |
| Replay | Re-submitting a captured request | 5-minute timestamp skew window + per-integrator nonce cache in `nonces` table with lazy GC |
| Key theft | Integrator secret leaks | Per-integrator secrets (`integratorKeys`), rotatable via `/admin/integrators` (planned M3.2); never logged |
| Tampering | Body swapped after signing | Signature covers the raw body string; verified before JSON parse |

### Admin API — `/admin/*` (planned M3)

| STRIDE | Threat | Mitigation |
| --- | --- | --- |
| Spoofing | Unauthenticated admin access | Session cookie (HttpOnly, Secure, SameSite=Strict) + TOTP on login |
| Tampering | Forged CSRF | CSRF double-submit token on every mutating `/admin/*` route (planned M6.2) |
| Elevation of privilege | Low-value session used for signer operations | TOTP step-up required on `send`, `rotate-key`, integrator-secret rotation |
| Repudiation | Admin denies an action | `audit_log` table records actor/action/target/signals (planned M3.4) |

### Abuse pipeline (`apps/server/src/abuse/*`, `packages/abuse-*`)

| STRIDE | Threat | Mitigation |
| --- | --- | --- |
| Tampering | Hashcash secret compared byte-by-byte | `timingSafeEqual` where user input meets an HMAC secret |
| DoS | External captcha / GeoIP outage stalling the pipeline | Soft-skip with a degraded signal; claim is never blocked purely because a third party is down (errors recorded in signals) |
| Info disclosure | Signals leaked to public response | Signals are surfaced only through admin routes |
| TOCTOU | Rate-limit counter read then written | Counter increments happen after the decision point; an extra request under a race worst-case grants one extra allow, not bypasses the layer |

### Faucet signer

| STRIDE | Threat | Mitigation |
| --- | --- | --- |
| Info disclosure | Private key on disk | Argon2id-derived KEK + XChaCha20-Poly1305 envelope in `/data/faucet.key` (planned M3.3) |
| Info disclosure | Key in logs / errors | Log scrubber forbids key material; errors from the driver are sanitised before response |
| Tampering | Key replaced on disk | Encrypted blob authenticated by Poly1305; decrypt fails loudly |
| Spoofing | Unauthorised `send` | Only reachable via `/admin/account/send` behind session + TOTP step-up |
| EoP | Key material zeroed on rotation | `rotate-key` writes new envelope then zero-fills the old buffer in memory |

### Currency drivers (`packages/driver-nimiq-*`)

| STRIDE | Threat | Mitigation |
| --- | --- | --- |
| Spoofing | Malicious RPC node | Operator trust boundary; recommend a pinned node under operator control; responses are schema-validated before use |
| Tampering | Malformed RPC response | Strict parsing in the driver; unknown shapes reject rather than coerce |
| DoS | Slow / hanging node | Timeouts on every outbound RPC; confirmation loop runs off the request path |

### Dashboard + claim UI

| STRIDE | Threat | Mitigation |
| --- | --- | --- |
| XSS | Injection via captcha / error strings | Vue template escaping by default; Content-Security-Policy via `@fastify/helmet` (planned M6.2) |
| CSRF | Cross-site admin mutation | `SameSite=Strict` session cookie + double-submit CSRF token (planned M6.2) |
| Info disclosure | Mixed content / cookie theft | `Secure` + `HttpOnly` cookies; TLS enforced in prod (refuse plain HTTP unless `FAUCET_DEV=1`) |
| Clickjacking | Admin embedded in third-party frame | `X-Frame-Options: DENY` / `frame-ancestors 'none'` via Helmet (planned M6.2) |
