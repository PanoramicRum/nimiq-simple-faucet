# @faucet/core

Framework- and coin-agnostic interfaces + utilities shared by every other
package. Private to this monorepo (not published to npm).

## What lives here

- **`CurrencyDriver`** — the interface every signer implements. Methods:
  `init`, `getBalance`, `getFaucetAddress`, `send`, `waitForConfirmation`,
  `addressHistory`, `parseAddress`. See `src/driver.ts`.
- **`AbuseCheck`** — the interface every abuse layer implements. A single
  `run(ctx, signals)` method that returns an allow/challenge/review/deny
  partial decision + scored signals. See `src/abuse.ts`.
- **`HostContext`** + `canonicalizeHostContext()` — integrator-supplied
  user signals that flow through the claim pipeline. See
  `src/hostContext.ts`.
- **`DriverError`** — typed error class surfaced across drivers.

## Extending

- **New currency:** implement `CurrencyDriver` in a new
  `packages/driver-<chain>/` and register it in the server's driver
  factory. The server is coin-agnostic by design.
- **New abuse layer:** implement `AbuseCheck` in a new
  `packages/abuse-<name>/` and register it in
  [`apps/server/src/abuse/pipeline.ts`](../../apps/server/src/abuse/pipeline.ts).

## License

MIT (inherits from the repo).
