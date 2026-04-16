# @faucet/driver-nimiq-wasm

Nimiq signer driver that runs an in-process Web Client via WASM and signs
transactions directly from a private key held by the faucet. Private to
this monorepo.

## When to use this driver

- You want a single-container deployment with no external Nimiq node.
- You're OK with the faucet process holding the private key
  (encrypted at rest under `FAUCET_KEY_PASSPHRASE`).
- You want the faucet to talk to the Nimiq network via the public seed
  peers (WSS transport) directly.

## Configuration

Set `FAUCET_SIGNER_DRIVER=wasm` and:

| Env | Purpose |
|-----|---------|
| `FAUCET_PRIVATE_KEY` | 64-char hex or 12/24-word mnemonic |
| `FAUCET_WALLET_ADDRESS` | Must match the address derived from the key |
| `FAUCET_KEY_PASSPHRASE` | Used to encrypt the key blob at rest under `/data/faucet.key` |

Optional: `FAUCET_NIMIQ_SEED_PEERS` to override the default seed list.

## Implementation notes

- Uses `@nimiq/core` (Web Client, Albatross). Loaded lazily via dynamic
  `import()` to keep the package importable in non-WASM tools.
- Sync mode is **light** — minutes to consensus, small blockchain
  footprint.
- `waitForConfirmation` already handles transient "tx not found yet"
  errors; the sibling [driver-nimiq-rpc](../driver-nimiq-rpc/) borrowed
  the same pattern for 1.0.0.
- `addressHistory` uses `getTransactionsByAddress` on the Web Client.

## Trade-offs vs the RPC driver

| | wasm | rpc |
|---|---|---|
| Ops complexity | single container | container + node |
| Key custody | in-process (encrypted at rest) | on the node (operator-managed) |
| Sync time | ~1 min cold start | node-managed |
| Network load | WSS to seed peers | node-to-node (depends on operator) |

## See also

- [@faucet/core](../core/) for the `CurrencyDriver` interface.
- [packages/driver-nimiq-rpc](../driver-nimiq-rpc/) for the external-node alternative.
