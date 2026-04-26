# Security policy

Thank you for helping keep Nimiq Simple Faucet and its integrators safe.

## Supported versions

Security fixes are backported to the current minor release only. Older
minor lines are expected to be upgraded rather than patched.

| Version          | Supported                           |
| ---------------- | ----------------------------------- |
| `main` (HEAD)    | Yes                                 |
| Current `1.x`    | Yes (most recent minor)             |
| Older `1.x`      | No — upgrade to the latest minor    |
| `< 1.0` tags     | No (pre-release; upgrade to `1.x`)  |

The recommended runtime is the most recent tag on
`ghcr.io/panoramicrum/nimiq-simple-faucet`. The `:latest` tag tracks it.

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Do **not** open a public
GitHub issue, a pull request, or a discussion thread for undisclosed
vulnerabilities.

Two private channels — pick whichever fits:

- **GitHub Security Advisory** (preferred for technical reports). Open a
  draft advisory at
  [`/security/advisories/new`](https://github.com/PanoramicRum/nimiq-simple-faucet/security/advisories/new).
  GHSAs let us coordinate the fix and CVE on the same thread, and the
  finder is automatically credited on the published advisory.
- **Email**: `richy@nimiq.com` for cases where GHSA isn't a fit
  (operator-side incidents, bulk forwarding, follow-up on a previously
  reported issue).
- If you fork or deploy your own instance, update this contact address in
  your copy of the file.

Include in the report:

1. A description of the issue and its impact.
2. Steps to reproduce (minimal proof-of-concept preferred).
3. Affected component(s): server route, abuse layer, SDK, driver, deploy
   artefact, etc.
4. Your name / handle for acknowledgement (optional).

## Response SLO

- **Acknowledgement:** within **72 hours** of receipt.
- **Triage + severity decision:** within **7 days**.
- **Fix target for HIGH / CRITICAL:** a patched release within **14 days** of
  triage (faster where feasible). MEDIUM / LOW on a best-effort basis, batched
  into the next scheduled release.

We will keep you updated at least weekly until the issue is closed.

## Scope

**In scope**

- All packages under `apps/` and `packages/` in this repository.
- The Docker image built from `deploy/docker/Dockerfile`.
- The compose and Helm deploy artefacts under `deploy/`.
- The OpenAPI spec and MCP server surface served by `apps/server`.

**Out of scope**

- Downstream integrator applications that embed the SDKs. Report those to the
  respective maintainers.
- Third-party services (MaxMind, IPinfo, Cloudflare Turnstile, hCaptcha,
  upstream Nimiq nodes) — report to the vendor. Self-hosted CAPTCHA
  services like [FCaptcha](https://github.com/WebDecoy/FCaptcha) are
  operator-run and upstream bugs should be reported to that project.
- Denial of service by exhausting a paid third-party quota (captcha, GeoIP) —
  this is an integrator-side capacity concern, not a faucet vulnerability.
- Social engineering of maintainers or integrators.

## Safe harbour

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction, and
  service disruption.
- Only interact with accounts and data they own, or have explicit permission
  to test.
- Give us a reasonable window to investigate and remediate before any public
  disclosure (see SLO above).
- Do not exploit findings beyond what is necessary to demonstrate the issue.

If in doubt, ask first — we would rather coordinate than surprise each other.

## Trust-boundary model

The audit reports under [`audits/`](./audits/) and several findings in our
issue tracker pivot on this question: which inputs does the server trust,
and which does it have to defend against? Document it once, here.

### Network metadata (auto-trusted only when proxied)

| Input              | Trust by default | Trust path |
|--------------------|------------------|------------|
| Socket peer IP     | Yes              | Bound by the OS — can't be forged on a TCP connection. |
| `X-Forwarded-For`  | **No**           | Honoured only when the upstream proxy IP matches `FAUCET_TRUSTED_PROXY_CIDRS` (audit #001 / issue #87). Empty by default → unproxied direct deployments are safe out of the box. |
| `Origin`           | Yes (filtered)   | Cross-checked against `FAUCET_CORS_ORIGINS`. Browser-only mode also rejects unknown origins. |
| `Sec-Fetch-Site`   | Hint-only        | Used only to gate browser-only mode. Treat as advisory: a non-browser caller can omit it. |
| User-Agent         | Hint-only        | Stored in audit log; not used for any access decision. |

### Client-supplied claim payload (untrusted by default)

Every field on `POST /v1/claim` is attacker-controlled — assume the
attacker is choosing the worst possible value at each layer.

| Field                    | Trusted? | Why / how validated |
|--------------------------|----------|---------------------|
| `address`                | No       | Validated against the Nimiq address checksum + normalised. Invalid addresses 400. |
| `captchaToken`           | No       | Verified against the configured captcha provider's `verify` endpoint per request. The provider is the source of trust, not the token. |
| `hashcashSolution`       | No       | Re-checked server-side against the same secret + difficulty + TTL the challenge was minted with; replay cache rejects already-seen solutions (#015 / issue #95). |
| `fingerprint.*`          | No       | Stored for correlation only; never directly used as an access decision. |
| `idempotencyKey`         | No       | Scoped by `(integratorId, key)` for authenticated callers; by `(key, address)` for the unauth path (#86). Cross-tenant collisions are not possible. |
| `hostContext.{trust-claims}` | **Cryptographically required** | `kycLevel`, `accountAgeDays`, `emailDomainHash`, `tags`, `verifiedIdentities` are honoured only when an integrator HMAC signature on the canonical bytes verifies. Unsigned claim → those fields are stripped before the abuse pipeline ever sees them (#016 / issue #96). |
| `hostContext.{uid, cookieHash, sessionHash}` | Correlation-only | Always preserved. Lying about a UID either evades correlation (no worse than not sending one) or trips correlation against the fingerprint visitor-id; either way the attacker doesn't gain trust. |

### Integrator-authenticated calls

Integrator HMAC auth (`X-Faucet-Api-Key` + signature over canonical
request bytes) does NOT extend trust to the request body unless the
relevant field also carries an in-band signature. The signed envelope
proves the integrator endorsed *the network call*, not the truthfulness
of every field inside.

The one exception is the `hostContext` per-field signature, which is
checked against `canonicalizeHostContext` (see
[`packages/core/src/hostContext.ts`](./packages/core/src/hostContext.ts)).

### Storage and at-rest

| Datum                      | At-rest protection |
|---------------------------|--------------------|
| Admin password             | Argon2id via `@node-rs/argon2`, salted per row. |
| Admin sessions             | Hashed token in DB; `__Host-`-prefixed cookie ferries the plaintext (#017 / issue #97). |
| Admin TOTP secret          | Argon2id-derived KEK + XChaCha20-Poly1305 encryption when `FAUCET_KEY_PASSPHRASE` is set; otherwise plaintext in the local SQLite (acceptable on a single-tenant volume, not on shared infra). |
| Integrator API keys        | SHA-256 hash only; the plaintext is returned **once** at create/rotate. |
| Integrator HMAC secrets    | Plaintext in DB — needed for symmetric verification. The DB is a sensitive-grade artefact; restrict filesystem access. |
| Wallet private key         | XChaCha20-Poly1305 keyring blob when `FAUCET_KEY_PASSPHRASE` is set. RPC-driver deployments hold the key in the Nimiq node, not in the faucet's data dir. |

### What we don't defend against

- **Compromised integrator**. If an integrator's HMAC secret leaks, the
  attacker can forge `hostContext` claims and replay HMAC-signed
  requests indefinitely. Rotate the secret via the admin dashboard
  (TOTP step-up required, audit-logged).
- **Compromised admin**. An admin with a valid session + TOTP can drain
  the wallet, rotate keys, mint integrator credentials. Audit log
  records every such action; the dashboard is gated behind password +
  TOTP + per-route rate-limit.
- **Compromised infrastructure**. We do not encrypt at-rest claim history
  or the audit log against an attacker who has shell access to the
  faucet container. Operators should restrict cluster access and run
  the chart with the bundled NetworkPolicy + PDB (#019, #021 / issue #101).

## Acknowledgements

Security researchers who report valid issues and honour the disclosure
window will be credited here (with their consent) and in the release notes
for the fix.

<!-- Acknowledgement entries are appended here per release. -->
