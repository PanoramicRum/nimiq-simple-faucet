# Security

Nimiq Simple Faucet is designed for unattended self-hosting. The project
publishes:

- A coordinated-disclosure policy in [`SECURITY.md`](../../../SECURITY.md) at
  the repo root.
- A threat model under [`docs/security/threat-model.md`](../../../docs/security/threat-model.md).
- An OWASP Top 10 review under [`docs/security/owasp-top10.md`](../../../docs/security/owasp-top10.md).
- A deployment hardening checklist reproduced at [Hardening](./hardening.md).

## TL;DR for integrators

- Always run behind TLS. Production refuses plain HTTP unless `FAUCET_DEV=1`.
- Rotate `FAUCET_ADMIN_PASSWORD` and enforce TOTP. Step-up re-auth is
  required for payouts and blocklist edits.
- Use the WASM signer with an encrypted keyring (`FAUCET_KEYRING_PATH`) for
  hot keys; reserve RPC signing for trusted internal networks.
- Set `FAUCET_HELMET_CSP=strict` if your integration does not need the
  dashboard CSS loaders.
- Prefer integrator HMAC signing for `hostContext` to prevent spoofed signals.

## Reporting a vulnerability

Follow the process in the top-level `SECURITY.md`. Do not open public issues
for suspected vulnerabilities.

## Dependency policy

- `pnpm audit` runs in CI and blocks high-severity advisories.
- First-party packages pin minor versions.
- Driver packages (`driver-nimiq-*`) isolate the only code that touches the
  network signer.
