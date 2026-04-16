# API overview

The faucet exposes a versioned REST API at `/v1/*` and a machine-readable
OpenAPI document at `/openapi.json`. All responses are JSON; all requests that
mutate state use `Content-Type: application/json`.

## OpenAPI

Every running server serves its own spec:

```bash
curl -s https://faucet.example.com/openapi.json | jq .
```

For a rendered browser view, any Stoplight, Swagger UI, or Redoc instance can
point at the same URL. The server also ships a built-in renderer at
`/docs/api` when the admin build flag is enabled.

A live interactive renderer will be embedded here in a future revision using a
`<ClientOnly>` Stoplight Elements component; for now, link out to a running
server:

```md
[Open API explorer](https://faucet.example.com/docs/api)
```

## Versioning

- Breaking changes bump the URL prefix (`/v1` → `/v2`).
- Additive changes (new optional fields, new endpoints) ship within the same
  major version.
- Every response includes `X-Faucet-Version` with the server semver.

## Authentication

| Surface | Auth |
| --- | --- |
| Public claim | Unauthenticated, rate-limited. |
| Integrator | `Authorization: Bearer <apiKey>` + signed `hostContext`. |
| Admin | Session cookie from `/v1/admin/login`; TOTP step-up for sensitive actions. |
| MCP admin tools | Bearer token from `FAUCET_ADMIN_MCP_TOKEN`. |

## Rate limits

| Scope | Default |
| --- | --- |
| Global per minute | `FAUCET_RATE_LIMIT_PER_MINUTE` (30) |
| Per IP per day | `FAUCET_RATE_LIMIT_PER_IP_PER_DAY` (5) |

Rejected requests return `429 Too Many Requests` with a `Retry-After` header.
