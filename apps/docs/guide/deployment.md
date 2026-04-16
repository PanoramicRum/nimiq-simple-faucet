# Deployment

Ready-made manifests live under `deploy/` at the repo root.

## Docker

```bash
docker run -d --name faucet \
  -p 8080:8080 \
  --env-file /etc/faucet/.env \
  -v faucet-data:/data \
  --restart unless-stopped \
  ghcr.io/panoramicrum/nimiq-simple-faucet:latest
```

Mount the keyring directory read-write; everything else can be read-only.

## Docker Compose

Minimal `compose.yaml`:

```yaml
services:
  faucet:
    image: ghcr.io/panoramicrum/nimiq-simple-faucet:latest
    env_file: .env
    ports:
      - "8080:8080"
    volumes:
      - faucet-data:/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: faucet
      POSTGRES_DB: faucet
    volumes:
      - pg-data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  faucet-data:
  pg-data:
```

> **Heads up (1.0.x):** server-side Postgres and Redis support are on the
> roadmap ([ROADMAP.md §1.3.x](../../../ROADMAP.md)). On 1.0.x the faucet
> uses SQLite in the `faucet-data` volume regardless of `DATABASE_URL` —
> setting `DATABASE_URL=postgres://...` today produces a clear startup
> error. The compose snippet above keeps the `postgres` and `redis`
> services defined so the stack is ready for when server-side support
> lands, but don't rely on them for persistence on 1.0.x.

## Helm

The chart under `deploy/helm/nimiq-faucet` provisions:

- A `Deployment` with `readOnlyRootFilesystem`, a writable `emptyDir` for
  `/data`, and secret-mounted keyring.
- A `Service` on port 8080.
- Optional `Ingress` with TLS from cert-manager.
- A `NetworkPolicy` restricting egress to the Nimiq RPC endpoint only.

```bash
helm install faucet ./deploy/helm/nimiq-faucet \
  --set image.tag=latest \
  --set config.network=test \
  --set-file secrets.env=/path/to/.env
```

## Reverse proxy

The server is safe behind any HTTP/2-capable proxy. Required headers:

- `X-Forwarded-For` — faucet reads it for rate limits and GeoIP.
- `X-Forwarded-Proto` — must be `https` in production or the server refuses
  the claim.

Caddy example:

```caddyfile
faucet.example.com {
  reverse_proxy 127.0.0.1:8080 {
    header_up X-Real-IP {remote_host}
  }
}
```

TLS is mandatory in production; set `FAUCET_TLS_REQUIRED=false` only for
development or when terminating TLS at a trusted upstream inside the cluster.
