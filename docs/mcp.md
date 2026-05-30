# MCP server reference

The faucet exposes a [Model Context Protocol](https://modelcontextprotocol.io) server at `/mcp` so AI coding assistants (Claude Code, Cursor, Continue, any MCP client) can read claim history, inspect abuse decisions, and — with admin auth — drive blocklist and send-tx operations.

Source: [apps/server/src/mcp/](../apps/server/src/mcp/) — [server.ts](../apps/server/src/mcp/server.ts) defines the tools, [index.ts](../apps/server/src/mcp/index.ts) wires them onto Fastify with auth.

## Transport

| Endpoint | Purpose |
|---|---|
| `GET /mcp` | Discovery — returns `{ name, version, transport: 'streamable-http', tools: [{name, admin}] }`. Lightweight enough to put behind a marketing-site link or a curl one-liner. |
| `POST /mcp` | The MCP transport. Streamable HTTP (JSON-RPC over HTTP with optional SSE). Stateless: one transport per request, no session IDs. |

`POST /mcp` shares the `adminLoginRatePerMinute` rate-limit bucket (per-IP) with `/admin/auth/login`. Every admin tool call is written to the audit log naming the resolved principal.

## Auth model

Public tools are unauthenticated. Admin tools require an `AdminPrincipal`, resolved upstream by [apps/server/src/mcp/index.ts](../apps/server/src/mcp/index.ts) — two paths, tried in order:

1. **Admin session + TOTP step-up** (preferred, tracked at #88). Client sends the `__Host-faucet_session` cookie obtained from `POST /admin/auth/login`. The session must have a fresh TOTP step-up within `FAUCET_ADMIN_TOTP_STEP_UP_TTL_MS`, either persisted on the session row or supplied as `x-faucet-totp: <code>` on the same request.
2. **Static `FAUCET_ADMIN_MCP_TOKEN`** (deprecated fallback). Sent via `x-faucet-admin-token: <token>`. Only honoured when `FAUCET_ADMIN_MCP_ALLOW_STATIC_TOKEN=true`. Kept so existing deployments don't break across the v1 → v2 admin-auth rewrite; flip the flag to `false` once your MCP clients are on the session path.

If no admin auth is presented (or it fails), public tools still work but admin tools return an MCP tool-call error of `Admin MCP auth required`.

## Tools

There are **9 tools**: 3 public, 6 admin-scoped.

### Public

#### `faucet.status`

Fetch a single claim by id.

```ts
input:  { id: string }
output: { id, status, address, amountLuna, txId, createdAt, decision, rejectionReason }
        | { error: 'not found', id }
```

#### `faucet.recent_claims`

List recent claims with PII stripped (no IP, no user-agent). Includes the abuse `decision`, `abuseScore`, and full structured `signals` JSON so an agent can reason about how a claim was scored.

```ts
input:  { limit?: number (1..200, default 20) }
output: Array<{ id, createdAt, address, amountLuna, status, txId,
                decision, abuseScore, signals, integratorId }>
```

#### `faucet.stats`

Aggregate counts across the most recent 100 claims.

```ts
input:  {}
output: { total, byStatus: Record<string, number>, byDecision: Record<string, number> }
```

### Admin-scoped

Every call below requires an `AdminPrincipal` (see [Auth model](#auth-model)) and is written to the audit log.

#### `faucet.balance`

Faucet wallet balance in Luna (decimal string — `BigInt`-compatible).

```ts
input:  {}
output: { balanceLuna: string }
```

#### `faucet.send`

Send Luna out of the faucet wallet. Validates the address through the active currency driver before broadcasting.

```ts
input:  { to: string, amountLuna: string /* decimal integer */ }
output: { txId: string, to: string, amountLuna: string }
```

#### `faucet.block_address`

Add an entry to the blocklist.

```ts
input:  { kind: 'ip' | 'address' | 'uid' | 'asn' | 'country',
          value: string,
          reason?: string,
          expiresAt?: number /* ms epoch */ }
output: { id: string, kind, value }
```

#### `faucet.unblock_address`

Remove blocklist entries matching `(kind, value)`. Multiple rows with the same key are all deleted.

```ts
input:  { kind: 'ip' | 'address' | 'uid' | 'asn' | 'country', value: string }
output: { removed: { kind, value } }
```

#### `faucet.list_blocks`

Enumerate blocklist entries, newest first.

```ts
input:  { limit?: number (1..1000, default 100) }
output: Array<{ id, kind, value, reason, expiresAt, createdAt }>
```

#### `faucet.explain_decision`

Return the full structured abuse-pipeline signals JSON for a claim. The same data backs the dashboard's per-claim "explain" modal.

```ts
input:  { claimId: string }
output: { id, decision, abuseScore, rejectionReason, signals }
        | { error: 'not found', claimId }
```

## Resources

Three read-only resources are also exposed via the MCP `resources/*` channel:

| URI | Description |
|---|---|
| `faucet://config` | Public faucet configuration — mirrors the `GET /v1/config` REST endpoint. |
| `faucet://openapi.json` | Placeholder. The authoritative OpenAPI spec lives at `GET /openapi.json` on the running server, or in the frozen [packages/openapi/openapi.yaml](../packages/openapi/openapi.yaml). |
| `faucet://recent-claims` | Last 50 claims (PII-sanitized). Equivalent to `faucet.recent_claims` with `limit: 50`. |

## Client setup

### Claude Code

Add to your `~/.claude.json` (or per-project `.mcp.json`):

```json
{
  "mcpServers": {
    "nimiq-faucet": {
      "type": "http",
      "url": "https://your-faucet.example.com/mcp"
    }
  }
}
```

For admin access, log into `/admin` first (browser keeps the session cookie); Claude Code then reuses it. For headless setups (CI, scripts), provision a token via `FAUCET_ADMIN_MCP_TOKEN` and configure your client to send `x-faucet-admin-token` — but the session+TOTP path is strongly preferred for human operators.

### Cursor / Continue / generic MCP clients

Same shape — `transport: streamable-http`, URL `<faucet>/mcp`. Refer to your client's MCP-server docs for the exact config-file location.

### curl smoke test

```bash
# Discovery
curl https://your-faucet.example.com/mcp

# Public tool: stats
curl -X POST https://your-faucet.example.com/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"faucet.stats","arguments":{}}}'
```

## See also

- [AGENTS.md](../AGENTS.md) — one-prompt recipes for integrators, including LLM-friendly framework code paths.
- [packages/openapi/openapi.yaml](../packages/openapi/openapi.yaml) — frozen wire-format reference.
- [/llms.txt](../apps/docs/public/llms.txt) and `/llms-full.txt` (served by the running faucet) — flat, scrapable surface for web-search agents.
