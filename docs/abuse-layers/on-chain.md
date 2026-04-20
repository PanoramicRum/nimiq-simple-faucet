# On-Chain Heuristics

Blockchain-level abuse detection for Nimiq. Inspects the target address's transaction history to identify sweeper wallets, fresh addresses, and sibling faucet clusters.

## How it works

The layer queries the Nimiq blockchain via `CurrencyDriver.addressHistory()` to analyze the target address:

1. **Sweeper detection:** Address receives from N distinct senders, then consolidates all funds to a single recipient within a short window. This is the classic pattern of a faucet farmer who collects small amounts across many addresses and sweeps them to one wallet.

2. **Fresh address scoring:** Address has no transaction history at all. While many legitimate users have new addresses, fresh addresses are also a signal of potential farming (creating disposable addresses for each claim).

3. **Faucet cluster detection:** Multiple sibling addresses were recently funded by the same faucet. Indicates coordinated claiming from the same actor.

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `FAUCET_ONCHAIN_ENABLED` | `false` | Enable on-chain heuristics |
| `FAUCET_ONCHAIN_DENY_IF_SWEEPER` | `true` | Hard-deny detected sweeper addresses |
| `FAUCET_ONCHAIN_SOFT_FRESH_ADDRESS` | `true` | Soft score bump (not hard deny) for new addresses |

### Requirements

This layer requires the Nimiq node to have transaction history indexing enabled:

- **RPC driver:** Set `index_history=true` in the Nimiq node's `client.toml`
- **WASM driver:** Always-on history via light client

## Decision logic

- **Sweeper pattern detected:** `deny` (if `DENY_IF_SWEEPER=true`) or `review`
- **Faucet cluster detected:** `review`
- **Fresh address (no history):** soft score bump (not hard deny)
- **Normal address:** `allow` with signals

## Trade-offs

- **Highly effective** against organized faucet farming (sweeper wallets are a strong signal)
- **Requires indexed RPC node** — adds infrastructure requirement
- **Query latency** depends on chain state and history depth
- **Fresh address soft-scoring** avoids rejecting legitimate new users while still flagging potential abuse
