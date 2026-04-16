# Quick start

Run the faucet locally in under a minute, then send yourself a first test-net NIM.

## 1. Start the server

```bash
docker run -d --name faucet \
  -p 8080:8080 \
  -e FAUCET_NETWORK=test \
  -e FAUCET_SIGNER_DRIVER=wasm \
  -e FAUCET_PRIVATE_KEY=$(openssl rand -hex 32) \
  -e FAUCET_KEY_PASSPHRASE=dev-only-change-me \
  -e FAUCET_ADMIN_PASSWORD=dev-only-change-me \
  -v faucet-data:/data \
  ghcr.io/panoramicrum/nimiq-simple-faucet:latest
```

The container listens on `:8080`:

- Claim UI: `http://localhost:8080/`
- Admin dashboard: `http://localhost:8080/admin`
- OpenAPI: `http://localhost:8080/openapi.json`
- MCP endpoint: `http://localhost:8080/mcp`

## 2. Fund the faucet

Send test-net NIM to the address printed by the wallet the container generated.
Grab it from the admin dashboard or via the MCP `faucet.balance` tool after
setting `FAUCET_ADMIN_MCP_TOKEN`.

```bash
curl -s http://localhost:8080/v1/config | jq .
```

## 3. First claim

Issue a claim via the public REST endpoint:

```bash
curl -s -X POST http://localhost:8080/v1/claim \
  -H 'content-type: application/json' \
  -d '{"address":"NQ00 0000 0000 0000 0000 0000 0000 0000 0000"}'
```

The response returns a claim id. Poll status with:

```bash
curl -s http://localhost:8080/v1/claim/<id>
```

## Next steps

- [Configuration](./configuration.md) — every environment variable grouped by topic.
- [Abuse prevention](./abuse-prevention.md) — how the pipeline scores a claim.
- [Host context](./host-context.md) — pass signed signals from your backend for better accuracy.
- [Deployment](./deployment.md) — Docker Compose, Helm, reverse proxy.
