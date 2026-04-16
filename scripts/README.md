# scripts/

Manual / on-demand scripts. Not part of CI.

## `smoke-testnet.mts`

End-to-end smoke test against a running faucet on **Nimiq testnet**. Run it after
a release candidate build to confirm the container can actually fund an address.

### Prerequisites

1. A faucet container running on testnet with an RPC or WASM signer that holds
   testnet NIM. For example:

   ```
   docker run -p 8080:8080 \
     -e FAUCET_NETWORK=test \
     -e FAUCET_SIGNER_DRIVER=rpc \
     -e FAUCET_RPC_URL=https://your-albatross-testnet-node.example \
     -e FAUCET_WALLET_ADDRESS=NQ… \
     -e FAUCET_ADMIN_PASSWORD=… \
     nimiq-faucet:rc
   ```

2. The faucet wallet has a non-zero testnet balance (grab NIM from the public
   testnet faucet first if needed).

### Run

```
FAUCET_BASE_URL=http://localhost:8080 pnpm smoke:testnet
```

Optional env:

- `FAUCET_RECIPIENT` — fund this specific address (skip keypair generation).
- `FAUCET_TIMEOUT_MS` — max wait for confirmation; default 120000.

### What it does

1. `GET /v1/config` — asserts `network === "test"` and reports enabled abuse layers.
2. Resolves a recipient: uses `FAUCET_RECIPIENT` if set, otherwise generates a
   fresh testnet keypair via `@nimiq/core`.
3. If hashcash is enabled, mints a challenge via `POST /v1/challenge` and solves
   it using `@faucet/abuse-hashcash`'s `solveChallenge`.
4. `POST /v1/claim` with the address + solution.
5. Polls `GET /v1/claim/:id` until `status === "confirmed"` or timeout.
6. Prints the tx hash + a `nimiq.watch` explorer link.

Exits non-zero on any failure.

### Not in CI

This script needs an external Nimiq testnet node and can be flaky for network
reasons. It is a local/manual pre-release gate, not a CI check. The
hermetic regression coverage lives in the per-package vitest suites
(`pnpm --filter @faucet/driver-nimiq-rpc test`, etc.) and the Playwright e2e.
