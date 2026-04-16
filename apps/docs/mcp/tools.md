# MCP tools

The canonical list is in `apps/server/src/mcp/server.ts`. The table below
mirrors the registrations there; regenerate when that file changes.

| Name | Scope | Input schema (summary) |
| --- | --- | --- |
| `faucet.status` | public | `{ id: string }` — fetch a single claim. |
| `faucet.recent_claims` | public | `{ limit?: 1..200 }` — PII-sanitized recent claims. |
| `faucet.stats` | public | `{}` — aggregate counts over last 100 claims. |
| `faucet.balance` | admin | `{}` — faucet wallet balance in Luna. |
| `faucet.send` | admin | `{ to: string, amountLuna: decimalString }` — out-of-band payout. |
| `faucet.block_address` | admin | `{ kind: 'ip'\|'address'\|'uid'\|'asn'\|'country', value: string, reason?: string, expiresAt?: number }` |
| `faucet.unblock_address` | admin | `{ kind, value }` — remove matching entries. |
| `faucet.list_blocks` | admin | `{ limit?: 1..1000 }` — newest-first listing. |
| `faucet.explain_decision` | admin | `{ claimId: string }` — full signals JSON. |

## Resources

| URI | MIME | Notes |
| --- | --- | --- |
| `faucet://config` | `application/json` | Public config (same as `GET /v1/config`). |
| `faucet://openapi.json` | `application/json` | OpenAPI spec. |
| `faucet://recent-claims` | `application/json` | Last 50 PII-sanitized claims. |

## Admin authentication

Admin tools use `FAUCET_ADMIN_MCP_TOKEN` compared with `timingSafeEqual`.
Missing or invalid tokens return a tool-call error — the surrounding MCP
connection stays open. The M3 milestone replaces the shared token with
short-lived admin sessions; see the inline `TODO(M3)` in
`apps/server/src/mcp/server.ts`.

## Example tool call

From any MCP client:

```bash
mcp call --server nimiq-faucet faucet.recent_claims --arg limit=10
```

For admin tools, set the bearer:

```bash
MCP_HTTP_HEADERS='Authorization: Bearer <token>' \
  mcp call --server nimiq-faucet faucet.balance
```
