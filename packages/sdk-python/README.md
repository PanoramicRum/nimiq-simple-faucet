# nimiq-faucet (Python SDK)

Pure-stdlib Python client for the [Nimiq Simple Faucet](https://github.com/PanoramicRum/nimiq-simple-faucet). Zero external dependencies. Python 3.10+.

## Install

```bash
pip install nimiq-faucet
```

## Quick start

```python
from nimiq_faucet import FaucetClient

client = FaucetClient("https://faucet.example.com")

# Submit a claim
response = client.claim("NQ02 STQX XESU 2E4S N9X7 GEXD 0VGL Y8PT BQ05")
print(response.id, response.status, response.tx_id)

# Wait for on-chain confirmation
confirmed = client.wait_for_confirmation(response.id)
print(confirmed.status)  # "confirmed"
```

## With hashcash (no third-party captcha)

```python
response = client.solve_and_claim("NQ02 ...")
```

## Server-to-server HMAC auth

```python
client = FaucetClient(
    "https://faucet.example.com",
    api_key="fk_...",
    hmac_secret="your-secret",
)
response = client.claim("NQ02 ...", ClaimOptions(
    host_context=HostContext(uid="user-123"),
))
```

## Per-field signed host context (v2.0+)

```python
from nimiq_faucet import FaucetClient, HostContext

# On your backend — sign the context with your integrator secret
ctx = HostContext(uid="user-123", verified_identities=["google"])
signed = FaucetClient.sign_host_context(ctx, "my-integrator-id", "hmac-secret")

# Pass signed context to the browser/mobile client
# The faucet server verifies the signature without needing the whole-request HMAC
```

## API reference

| Method | Description |
|--------|-------------|
| `config()` | GET /v1/config |
| `claim(address, options?)` | POST /v1/claim |
| `status(id)` | GET /v1/claim/:id |
| `request_challenge(uid?)` | POST /v1/challenge |
| `solve_and_claim(address, options?)` | Challenge + solve + claim |
| `wait_for_confirmation(id, timeout_s?)` | Poll until terminal |
| `sign_host_context(ctx, id, secret)` | Per-field HMAC (static) |

## License

MIT
