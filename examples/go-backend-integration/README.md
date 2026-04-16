# Go Backend Integration Example

Minimal Go HTTP server demonstrating server-side faucet integration using `github.com/PanoramicRum/nimiq-simple-faucet/packages/sdk-go`.

## What this demonstrates

- `faucet.New()` client construction
- `Config()` to fetch faucet configuration
- `SolveAndClaim()` with hashcash challenge solving
- `WaitForConfirmation()` polling
- A backend proxy pattern where your server claims on behalf of users

## Endpoints

| Method | Path       | Description                              |
|--------|------------|------------------------------------------|
| GET    | /healthz   | Health check                             |
| GET    | /config    | Fetch and return faucet config           |
| POST   | /claim     | `{"address":"NQ..."}` — claim and wait   |

## Run locally

```bash
cd examples/go-backend-integration
FAUCET_URL=http://localhost:8080 go run .
# In another terminal:
curl -X POST http://localhost:8081/claim -d '{"address":"NQ00 0000 0000 0000 0000 0000 0000 0000 0000"}'
```

## Run with Docker

```bash
# From repo root
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up --build example-go
# Test:
curl http://localhost:3005/config
curl -X POST http://localhost:3005/claim -d '{"address":"NQ00 0000 0000 0000 0000 0000 0000 0000 0000"}'
```
