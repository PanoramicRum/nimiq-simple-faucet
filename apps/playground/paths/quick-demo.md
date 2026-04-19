# 🚀 Quick demo <Badge type="tip" text="~5-10 min" />

Boot the compose stack, confirm `/admin` loads, and you are done. The fastest way to see the Nimiq Faucet in action.

## Execution Steps

### 1. Clone the repository

```bash
git clone https://github.com/PanoramicRum/nimiq-simple-faucet
cd nimiq-simple-faucet/deploy/compose
```

### 2. Boot the stack

```bash
cp .env.example .env
docker compose --profile local-node up -d
```

### 3. Verify

Navigate to [http://localhost:8080/admin](http://localhost:8080/admin) to see the dashboard.

Check health:

```bash
curl http://localhost:8080/healthz
# → {"ok":true}

curl http://localhost:8080/readyz
# → {"ready":true,"checks":{"driver":"ok","db":"ok","balance":"..."}}
```

## What to expect

- A local Nimiq core node running in Albatross mode
- A fully functional Faucet backend API
- The administrative dashboard on port 8080

## Troubleshooting

Running into port conflicts or Docker permission issues?

→ [View common Docker issues](https://github.com/PanoramicRum/nimiq-simple-faucet/issues)

::: tip Path Complete
Once you can see the admin dashboard, you've completed this path! Try [Docker container trial](./docker-trial) next to make a real testnet claim.
:::
