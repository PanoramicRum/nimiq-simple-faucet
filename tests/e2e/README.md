# Nimiq Simple Faucet — Playwright E2E

End-to-end test suite (milestone M5) that boots the Fastify server in-process
against a stub `CurrencyDriver`, serves the built `claim-ui` and `dashboard`
SPAs, and drives them through chromium, firefox, and webkit.

## Prerequisites

- `pnpm install` at repo root (picks up this package via the `tests/*`
  workspace glob).
- Built UIs before running — the suite fails fast with
  `run 'pnpm -r build' first` if the `dist/` directories are missing:
  ```sh
  pnpm -r build
  ```
- Browser binaries (one-time, local dev):
  ```sh
  pnpm run test:e2e:install
  ```

## Run

```sh
pnpm run test:e2e
```

Or, scoped:

```sh
pnpm --filter @nimiq-faucet/e2e test
```

The suite:

1. `globalSetup` starts Fastify via `buildApp(...)` on `127.0.0.1:0` and writes
   the resolved URL to `process.env.FAUCET_E2E_BASE_URL` plus
   `./.e2e-state.json`.
2. Each project (chromium / firefox / webkit) runs the three spec files
   serially against the shared server.
3. `globalTeardown` closes the Fastify instance and wipes the temp data dir.

## Deterministic test fixtures

These values are fixed in `globalSetup.ts` / `helpers/server.ts` so tests can
reason about them end-to-end:

| Name                           | Value                               |
| ------------------------------ | ----------------------------------- |
| `FAUCET_ADMIN_PASSWORD`        | `admin-pass-123`                    |
| `FAUCET_ADMIN_TOTP_SECRET`     | `JBSWY3DPEHPK3PXP`                  |
| `FAUCET_HASHCASH_SECRET`       | `e2e-hashcash-secret-chars-16plus`  |
| `FAUCET_HASHCASH_DIFFICULTY`   | `8` (solves in < 1 s)               |
| `FAUCET_RATE_LIMIT_PER_IP_PER_DAY` | `5`                             |

`totpCode()` in `helpers/server.ts` uses `otplib` to mint valid 6-digit codes
on demand.

## CI notes

The parent CI job owns `playwright install --with-deps`; do not add it to a
per-run script. Run order matters only inside `admin.spec.ts`, which uses
`test.describe.configure({ mode: 'serial' })` because the first-login flow is
one-shot.

Trace + screenshot on failure are enabled; in CI, retries are set to 2.
