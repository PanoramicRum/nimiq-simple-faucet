# MCP overview

The Model Context Protocol (MCP) is an open standard for letting LLM agents
call tools and read resources from external services. Every running faucet
exposes an MCP endpoint at `/mcp` over HTTP + SSE.

## Why it's useful

Agents plugged in to the faucet MCP can:

- Check balance and send NIM (admin-scoped).
- List recent claims and explain a specific decision.
- Add and remove blocklist entries.
- Read public config and the live OpenAPI document as MCP resources.

All tools are enumerated on the [Tools](./tools.md) page.

## Point Claude Code at the faucet

Add an entry to `~/.config/claude-code/mcp.json`:

```json
{
  "mcpServers": {
    "nimiq-faucet": {
      "transport": "http",
      "url": "https://faucet.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <FAUCET_ADMIN_MCP_TOKEN>"
      }
    }
  }
}
```

Reload Claude Code; tools appear under the `nimiq-faucet` prefix.

## Point Cursor at the faucet

Cursor's settings use the same schema:

```json
{
  "mcp": {
    "servers": {
      "nimiq-faucet": {
        "url": "https://faucet.example.com/mcp",
        "headers": {
          "Authorization": "Bearer <FAUCET_ADMIN_MCP_TOKEN>"
        }
      }
    }
  }
}
```

## Public vs. admin tools

- **Public tools** are callable without the admin bearer: `faucet.status`,
  `faucet.recent_claims`, `faucet.stats`. They omit PII (IP, user-agent).
- **Admin tools** require the `FAUCET_ADMIN_MCP_TOKEN` header and cover
  balance, send, blocklist management, and decision explanation.

See [Tools](./tools.md) for the full matrix and input schemas.
