# docker-compose deployment

Brings the faucet up together with Postgres, Redis, and optionally a local
Nimiq (`core-rs-albatross`) node.

## Choosing an RPC backend

The faucet's `rpc` signer driver needs to reach a Nimiq Albatross JSON-RPC
endpoint. Pick **one** of:

### Option A — Use an external RPC URL

Point `FAUCET_RPC_URL` at an existing Nimiq Albatross node (a community
endpoint, a shared testnet node, or one you run elsewhere). This is the
default when you just start the stack without any profile.

1. Copy `.env.example` to `.env` and set:
   ```
   FAUCET_RPC_URL=https://your-albatross-testnet-rpc.example
   FAUCET_WALLET_ADDRESS=NQ...
   FAUCET_ADMIN_PASSWORD=...
   ```
2. Bring the stack up:
   ```
   docker compose up -d
   ```

### Option B — Run your own local Nimiq node

Start a testnet `core-rs-albatross` node in the same compose project. The
faucet reaches it via the compose-internal hostname `nimiq`. No
`FAUCET_RPC_URL` override is needed — the compose file defaults to
`http://nimiq:8648` when the env var is unset.

1. Copy `.env.example` to `.env` and leave `FAUCET_RPC_URL` unset (or set to
   `http://nimiq:8648` explicitly).
2. Bring the stack up **with the `local-node` profile**:
   ```
   docker compose --profile local-node up -d
   ```
3. Watch the node sync (initial sync can take minutes → an hour):
   ```
   docker compose logs -f nimiq
   ```
4. Once consensus is established, the faucet can send transactions.

On first boot the faucet's RPC driver auto-imports the configured wallet
(`FAUCET_WALLET_ADDRESS` + `FAUCET_PRIVATE_KEY` from `.env`) into the
node via `importRawKey` and unlocks it with `FAUCET_KEY_PASSPHRASE` — no
manual `curl importRawKey` / `unlockAccount` required (since v1.1.2).

The node's config lives in [`nimiq-node/client.toml`](nimiq-node/client.toml);
edit it to switch to mainnet, enable basic auth on the RPC port, expose
metrics, etc.

## Switching between the two

The `local-node` profile is additive — to go from Option B back to Option A,
stop the stack, clear the `FAUCET_RPC_URL` setting (or point it at your
external node), and restart **without** `--profile local-node`:

```
docker compose --profile local-node down
# edit .env to set FAUCET_RPC_URL=https://...
docker compose up -d
```

## Volumes

- `faucet-data` — faucet DB + encrypted key material
- `postgres-data` — Postgres data directory
- `nimiq-data` — blockchain data for the local Nimiq node (only used with
  the `local-node` profile)

## Smoke test

After the stack is up and the node (if used) has reached consensus, run:

```
FAUCET_BASE_URL=http://localhost:8080 pnpm smoke:testnet
```

See [`../../scripts/README.md`](../../scripts/README.md).
