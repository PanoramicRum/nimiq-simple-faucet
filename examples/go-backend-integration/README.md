# Go Backend Integration Example

Go HTTP server demonstrating server-side faucet integration using `github.com/PanoramicRum/nimiq-simple-faucet/packages/sdk-go`, **with full abuse-layer support**: HMAC-signed `hostContext` and hashcash via `SolveAndClaim`.

## What this demonstrates

- `faucet.New()` client construction
- `Config()` to fetch faucet configuration
- **`SignHostContext()` — HMAC-signed user-state assertions** (load-bearing in the faucet's abuse pipeline)
- **`SolveAndClaim()` — automatic hashcash challenge round-trip** (works whether or not the server requires PoW)
- `WaitForConfirmation()` polling
- A backend proxy pattern where your server claims on behalf of users

## Endpoints

| Method | Path       | Body                                         | Description |
|--------|------------|----------------------------------------------|-------------|
| GET    | /healthz   | —                                            | Health check |
| GET    | /config    | —                                            | Fetch and return faucet config |
| POST   | /claim     | `{"address":"NQ...","userId":"u-1","kyc":"email"}` | Sign hostContext + solve hashcash + claim |

`userId` and `kyc` are optional. With `FAUCET_HMAC_SECRET` set, the server signs the resulting hostContext so the faucet trusts the asserted user-state fields.

## Configuration

| Env var                  | Required | Default                   | Notes |
|--------------------------|----------|---------------------------|-------|
| `FAUCET_URL`             | no       | `http://localhost:8080`   | Faucet base URL |
| `FAUCET_INTEGRATOR_ID`   | no       | `go-backend-example`      | Identifier embedded in `hostContext.uid` and HMAC signature prefix |
| `FAUCET_HMAC_SECRET`     | **prod** | unset                     | Server-only HMAC secret. With it set, claims carry signed `hostContext`. Without it the demo still works (uid is sent unsigned) but asserted fields are not load-bearing. |

Copy [`.env.example`](./.env.example) to `.env` and adjust.

## Run locally

```bash
cd examples/go-backend-integration
cp .env.example .env  # edit FAUCET_HMAC_SECRET
FAUCET_URL=http://localhost:8080 \
  FAUCET_HMAC_SECRET="$(openssl rand -hex 32)" \
  go run .

# In another terminal:
curl -X POST http://localhost:8081/claim \
  -H 'content-type: application/json' \
  -d '{"address":"NQ00 0000 0000 0000 0000 0000 0000 0000 0000","userId":"alice","kyc":"email"}'
```

## Run with Docker

```bash
# From repo root
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up --build example-go
curl http://localhost:3005/config
curl -X POST http://localhost:3005/claim -d '{"address":"NQ00 0000 0000 0000 0000 0000 0000 0000 0000"}'
```

## Abuse layers

| Layer | How this example demonstrates it |
|-------|----------------------------------|
| **Hashcash** | `SolveAndClaim()` calls `Config()` → `RequestChallenge()` → solves the SHA-256 PoW → posts the solution. If the server has no hashcash configured, this is identical to a plain `Claim()`. |
| **`hostContext` (HMAC-signed)** | `SignHostContext(ctx, integratorID, hmacSecret)` — the faucet verifies the HMAC and treats `uid`, `kycLevel`, `accountAgeDays`, `tags` as load-bearing. **Without a signature, asserted fields are ignored.** |
| **Captcha (Turnstile/hCaptcha)** | Not applicable to a backend proxy — captcha tokens come from the *user's* browser and would be forwarded by the frontend. The proxy passes whatever `captchaToken` the frontend supplied. |
| **Fingerprint** | Same — fingerprints come from the user's device; the proxy forwards `fingerprint` as supplied. |
| **GeoIP / On-chain / AI** | Server-side only — invisible to the integrator. |

Server-side details: [`docs/abuse-prevention.md`](../../docs/abuse-prevention.md) and [`packages/abuse-hostcontext/README.md`](../../packages/abuse-hostcontext/README.md).
