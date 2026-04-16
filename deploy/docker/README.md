# Single-image deploy (SQLite default)

Build from the repo root:

```bash
docker build -f deploy/docker/Dockerfile -t nimiq-faucet:dev .
```

Run (RPC signer, testnet):

```bash
docker run -d --name faucet \
  -p 8080:8080 \
  -v faucet-data:/data \
  -e FAUCET_NETWORK=test \
  -e FAUCET_SIGNER_DRIVER=rpc \
  -e FAUCET_RPC_URL=https://rpc.testnet.example/ \
  -e FAUCET_WALLET_ADDRESS="NQ12 ..." \
  -e FAUCET_ADMIN_PASSWORD=change-me \
  -e FAUCET_TURNSTILE_SITE_KEY=... \
  -e FAUCET_TURNSTILE_SECRET=... \
  nimiq-faucet:dev
```

Persist claims + blocklist in `/data`. Swap to Postgres + Redis with `deploy/compose/docker-compose.yml`.
