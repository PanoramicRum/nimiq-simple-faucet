# Security policy

Thank you for helping keep Nimiq Simple Faucet and its integrators safe.

## Supported versions

This project is pre-1.0. Only the current `main` branch (and the most recent
tagged release image `ghcr.io/panoramicrum/nimiq-simple-faucet:latest`) receives security
fixes. Older tags will not be patched; upgrade to `main` or the latest tag.

| Version       | Supported |
| ------------- | --------- |
| `main` (HEAD) | Yes       |
| `< 1.0` tags  | No (upgrade to latest) |

Once 1.0 ships, this table will be revised to cover the current and previous
minor release lines.

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Do **not** open a public
GitHub issue, a pull request, or a discussion thread for undisclosed
vulnerabilities.

- Email: `richy@nimiq.com`
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
  upstream Nimiq nodes) — report to the vendor.
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

## Acknowledgements

Security researchers who report valid issues and honour the disclosure
window will be credited here (with their consent) and in the release notes
for the fix.

<!-- Acknowledgement entries are appended here per release. -->
