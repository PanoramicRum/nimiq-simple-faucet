# Documentation

Project docs grouped by audience. For an overview of the project, start at
the [root README](../README.md).

## Operators (running the faucet)

- [admin-first-run.md](./admin-first-run.md) — login → TOTP enrolment → fund wallet → first claim
- [deployment-production.md](./deployment-production.md) — TLS, secrets, Postgres, Helm chart
- [health-observability.md](./health-observability.md) — what `/healthz` checks, alerting, logs
- [smoke-testing.md](./smoke-testing.md) — end-to-end testnet validation (BYO wallet or generate fresh)

## Integrators (embedding in your app)

- [integrator-hmac.md](./integrator-hmac.md) — HMAC-signed backend requests with Node / Go / curl examples
- Per-SDK READMEs: [sdk-ts](../packages/sdk-ts/), [sdk-react](../packages/sdk-react/), [sdk-vue](../packages/sdk-vue/), [sdk-capacitor](../packages/sdk-capacitor/), [sdk-react-native](../packages/sdk-react-native/), [sdk-flutter](../packages/sdk-flutter/), [sdk-go](../packages/sdk-go/)
- [../AGENTS.md](../AGENTS.md) — per-framework recipes for AI coding agents

## Maintainers (contributing to this repo)

- [release-playbook.md](./release-playbook.md) — tag → publish flow, NPM_TOKEN provisioning, rc dry-runs
- [release-polish-plan.md](./release-polish-plan.md) — historical pre-1.0 polish plan (reference)
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — dev setup, repository layout, code style
- [../ROADMAP.md](../ROADMAP.md) — post-1.0 plans + ongoing quality programs

## Security

- [security/threat-model.md](./security/threat-model.md) — STRIDE analysis per component
- [security/hardening-checklist.md](./security/hardening-checklist.md) — production hardening items
- [security/owasp-top10.md](./security/owasp-top10.md) — OWASP Top 10 per endpoint
- [../SECURITY.md](../SECURITY.md) — vulnerability reporting policy
