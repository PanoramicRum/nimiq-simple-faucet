# Endpoints

> Regenerate-me: this page is a hand-curated summary. The authoritative
> schema lives in `/openapi.json` and is regenerated on every release. When
> you change a route handler, update the spec first and re-run the snippet
> pipeline before editing this page.

## Public

### `GET /v1/config`

Returns non-secret runtime config — active captcha provider, claim amount,
enabled abuse layers, and hashcash parameters when applicable. Safe to fetch
from the browser.

### `POST /v1/claim`

Request a claim. Body:

```json
{
  "address": "NQ00 0000 ...",
  "hostContext": { "uid": "...", "kycLevel": "email", "signature": "..." },
  "captchaToken": "<provider-token>",
  "hashcashProof": "<nonce>"
}
```

Response: `{ "id": "clm_...", "status": "pending" | "confirmed" | "review" }`.

### `GET /v1/claim/:id`

Poll a claim's status. Returns the same shape as `POST /v1/claim` plus
`txId` once the transaction is broadcast.

### `GET /v1/hashcash/challenge`

Returns `{ "challenge": "...", "difficulty": 20, "expiresAt": 169... }`.
Only present when hashcash is enabled.

## Admin

All admin routes require a logged-in session. Sensitive actions additionally
require a TOTP step-up.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/admin/login` | Password + TOTP; issues a session cookie. |
| `POST` | `/v1/admin/logout` | Revokes the session. |
| `GET`  | `/v1/admin/claims` | Paginated claims with decision + signals. |
| `GET`  | `/v1/admin/claims/:id` | Full claim detail. |
| `POST` | `/v1/admin/blocklist` | Add a blocklist entry. |
| `DELETE` | `/v1/admin/blocklist/:id` | Remove a blocklist entry. |
| `GET`  | `/v1/admin/blocklist` | List blocklist. |
| `POST` | `/v1/admin/send` | Out-of-band payout. Step-up TOTP required. |

## Discovery

| Path | Content |
| --- | --- |
| `/openapi.json` | Machine-readable schema. |
| `/llms.txt` | Short LLM onboarding doc. |
| `/llms-full.txt` | Exhaustive LLM doc. |
| `/mcp` | MCP (HTTP+SSE) endpoint. |

See [MCP](../mcp/overview.md) for the agent-facing tool list.
