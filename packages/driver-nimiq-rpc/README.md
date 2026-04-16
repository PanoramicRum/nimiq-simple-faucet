# @faucet/driver-nimiq-rpc

Nimiq signer driver that delegates to an external `core-rs-albatross`
JSON-RPC node. Private to this monorepo.

## When to use this driver

- You already run a Nimiq Albatross node (or use a managed RPC provider).
- The faucet wallet's private key lives on the **node**, pre-unlocked
  there. The faucet process never sees raw key material.
- Simpler to operate in Kubernetes if you already have a node service
  running.

## Configuration

Set `FAUCET_SIGNER_DRIVER=rpc` and:

| Env | Purpose |
|-----|---------|
| `FAUCET_RPC_URL` | Node RPC endpoint (e.g. `http://nimiq:8648`) |
| `FAUCET_RPC_USERNAME` | Optional basic-auth username |
| `FAUCET_RPC_PASSWORD` | Optional basic-auth password |
| `FAUCET_WALLET_ADDRESS` | The faucet's address (must be unlocked on the node) |

## Implementation notes

- Verified against `core-rs-albatross` 1.4.0-pre1.
- Uses JSON-RPC methods: `getNetworkId`, `getAccountByAddress`,
  `sendBasicTransaction`, `sendBasicTransactionWithData`,
  `getTransactionByHash`, `getTransactionsByAddress`, `getBlockNumber`.
- `waitForConfirmation` swallows transient "not found" errors until the
  deadline (fixed in 1.0.0 — see fix commit for context).
- `addressHistory` requires the node to be started with
  `index_history = true` in `client.toml`.

## See also

- [@faucet/core](../core/) for the `CurrencyDriver` interface.
- Sibling driver: [@faucet/driver-nimiq-wasm](../driver-nimiq-wasm/) for
  the in-process alternative.
