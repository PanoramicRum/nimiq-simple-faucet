# @faucet/abuse-onchain-nimiq

On-chain heuristics abuse layer for Nimiq. Looks at the target address's
history on-chain to flag common abuse patterns.

Implements `AbuseCheck` from [@faucet/core](../core/) — registered in
[`apps/server/src/abuse/pipeline.ts`](../../apps/server/src/abuse/pipeline.ts).

## Config

| Env | Default | Purpose |
|-----|---------|---------|
| `FAUCET_ONCHAIN_ENABLED` | `false` | Set `true` to enable |
| `FAUCET_ONCHAIN_DENY_IF_SWEEPER` | `true` | Reject addresses that sweep incoming funds to exchanges |
| `FAUCET_ONCHAIN_SOFT_FRESH_ADDRESS` | `true` | Score bump (not reject) on never-seen addresses |

## Heuristics

- **Sweeper pattern** — address receives from N distinct senders then
  consolidates to a single recipient within T minutes.
- **Fresh address** — never-seen address (no history). Soft signal by
  default (many legitimate users fall here).
- **Recent faucet clusters** — sibling addresses recently funded by
  the same faucet (cross-claim detection).

Uses `CurrencyDriver.addressHistory?.()` — requires the driver
to have indexing enabled (`index_history = true` on the RPC node, or
always-on with the WASM driver).

## Behaviour

- `deny` on sweeper match (when enabled).
- `review` on recent faucet-cluster match.
- `allow` + soft score on fresh addresses.

## See also

- [@faucet/core](../core/) — `CurrencyDriver.addressHistory` contract
- Sibling drivers: [driver-nimiq-rpc](../driver-nimiq-rpc/), [driver-nimiq-wasm](../driver-nimiq-wasm/)
