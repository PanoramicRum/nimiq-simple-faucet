# Python Backend Integration Example

Python backend example showing the `nimiq-faucet` Python SDK with **full abuse-layer support**: HMAC-signed `hostContext` and automatic hashcash via `solve_and_claim()`.

## What this demonstrates

- `FaucetClient` instantiation
- `solve_and_claim(...)` — automatic hashcash challenge round-trip
- `FaucetClient.sign_host_context(...)` — HMAC-signed user-state assertions
- Backend pattern: authenticate the user → vouch for their state → faucet trusts asserted fields
- `wait_for_confirmation()` polling

## Configuration

| Env var                  | Required | Default                           | Notes |
|--------------------------|----------|-----------------------------------|-------|
| `FAUCET_URL`             | no       | `http://localhost:8080`           | Faucet base URL (S2S, doesn't need to be browser-reachable) |
| `FAUCET_INTEGRATOR_ID`   | no       | `python-backend-example`          | Identifier embedded in `hostContext.uid` and HMAC signature prefix |
| `FAUCET_HMAC_SECRET`     | **prod** | unset                             | Server-only HMAC secret. With it set, claims carry signed `hostContext`. Without it the demo still works (uid is sent unsigned) but asserted fields are not load-bearing. Generate: `openssl rand -hex 32`. |
| `FAUCET_API_KEY`         | no       | unset                             | Optional whole-request HMAC for S2S auth (separate from hostContext signing) |

Copy [`.env.example`](./.env.example) to `.env` and adjust.

## Run locally

```bash
pip install nimiq-faucet
cp examples/python-backend-integration/.env.example examples/python-backend-integration/.env
# edit .env to set FAUCET_HMAC_SECRET
export $(grep -v '^#' examples/python-backend-integration/.env | xargs)
python examples/python-backend-integration/app.py
```

## With Docker

```bash
docker build -t python-faucet-example examples/python-backend-integration
docker run --rm \
  -e FAUCET_URL=http://host.docker.internal:8080 \
  -e FAUCET_HMAC_SECRET="$(openssl rand -hex 32)" \
  python-faucet-example
```

## Use from Flask / FastAPI / Django

The example exposes a single function `handle_claim(address, user_id=..., kyc_level=..., account_age_days=..., tags=...)`. Drop it behind any framework:

```python
# FastAPI
from fastapi import FastAPI
from app import handle_claim

api = FastAPI()

@api.post("/claim")
def claim(req: ClaimRequest, user = Depends(authenticated_user)):
    return handle_claim(
        req.address,
        user_id=user.id,
        kyc_level=user.kyc_level,
        account_age_days=user.account_age_days,
        tags=user.feature_tags,
    )
```

```python
# Flask
from flask import Flask, request, jsonify
from app import handle_claim

app = Flask(__name__)

@app.post("/claim")
def claim():
    user = require_auth(request)
    return jsonify(handle_claim(
        request.json["address"],
        user_id=user.id,
        kyc_level=user.kyc_level,
    ))
```

## Abuse layers

| Layer | How this example demonstrates it |
|-------|----------------------------------|
| **Hashcash** | `solve_and_claim()` calls `request_challenge()` → `solve_hashcash()` → `claim()` with the solution. On servers without hashcash configured, this is identical to a plain `claim()`. |
| **`hostContext` (HMAC-signed)** | `FaucetClient.sign_host_context(ctx, integrator_id, hmac_secret)` — the faucet verifies the HMAC and treats `uid`, `kyc_level`, `account_age_days`, `tags` as load-bearing. **Without a signature, asserted fields are ignored.** |
| **Captcha (Turnstile/hCaptcha)** | Not applicable to a backend — captcha tokens come from the *user's* browser. The backend forwards `captcha_token` if the frontend supplied one. |
| **Fingerprint** | Same — fingerprints come from the user's device; the backend forwards `fingerprint` as supplied. |
| **GeoIP / On-chain / AI** | Server-side only — invisible to the integrator. |

Server-side details: [`docs/abuse-prevention.md`](../../docs/abuse-prevention.md) and [`packages/abuse-hostcontext/README.md`](../../packages/abuse-hostcontext/README.md).
