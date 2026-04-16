# Local Nimiq node

This directory holds the config for an optional local `core-rs-albatross`
full node that the faucet can talk to via JSON-RPC.

It is **off by default** — enable it with the `local-node` compose profile:

```
docker compose --profile local-node up -d
```

See [`../README.md`](../README.md) for the full "external RPC vs. local node"
walkthrough.

## Files

- `client.toml` — minimal testnet full-node config. RPC bound to `0.0.0.0:8648`
  inside the container; reachable on the compose network as `http://nimiq:8648`.

## Data persistence

The node's blockchain data lives in the `nimiq-data` named volume
(`/home/nimiq/.nimiq` inside the container). Initial sync can take several
minutes to an hour depending on bandwidth.
