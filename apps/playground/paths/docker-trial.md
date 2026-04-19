# 🐳 Docker container trial <Badge type="tip" text="~20 min" />

Spin the full stack, fund a wallet, claim a real testnet tx. End state: admin dashboard open, confirmed tx in the claims table.

## Execution Steps

### 1. Generate a wallet

```bash
pnpm generate:wallet
```

Copy the printed address and private key into `.env`.

### 2. Fund the wallet

Visit [https://faucet.pos.nimiq-testnet.com](https://faucet.pos.nimiq-testnet.com) and send NIM to your generated address.

### 3. Boot with local node

```bash
docker compose --profile local-node up -d
```

### 4. Wait for consensus

```bash
docker compose logs -f nimiq
# Wait for "Consensus established"
```

### 5. Make a claim

```bash
curl -s -X POST http://localhost:8080/v1/claim \
  -H 'content-type: application/json' \
  -d '{"address":"NQ02 STQX XESU 2E4S N9X7 GEXD 0VGL Y8PT BQ05"}'
```

## What to expect

A `{"status":"broadcast","txId":"..."}` response, followed by the claim appearing as "confirmed" in the admin dashboard.

::: tip Path Complete
You've made a real testnet transaction! Next: [Full platform walkthrough](./full-walkthrough).
:::
