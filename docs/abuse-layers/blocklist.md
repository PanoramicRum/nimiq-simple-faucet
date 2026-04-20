# Blocklist

Admin-maintained deny-list that instantly rejects claims from known bad actors. Matches on IP address, Nimiq address, UID, ASN number, or country code. Entries can have optional expiry timestamps.

## How it works

When a claim arrives, the blocklist check queries the database for any entry matching the request's IP, target address, or UID. If a non-expired match is found, the claim is immediately denied with the stored reason. The blocklist has the highest weight (5) in the pipeline, meaning it overrides all other layers.

Blocklist entries are managed via the admin dashboard (`/admin/abuse`) or the admin API.

## Configuration

This layer is **always on** — there is no env var to disable it. An empty blocklist simply allows all claims through.

| Action | Method | Endpoint |
|--------|--------|----------|
| List entries | GET | `/admin/blocklist` |
| Add entry | POST | `/admin/blocklist` |
| Remove entry | DELETE | `/admin/blocklist/:id` |

### Entry types

| Kind | Example | What it blocks |
|------|---------|---------------|
| `ip` | `192.168.1.100` | Single IP address |
| `address` | `NQ02 STQX ...` | Nimiq wallet address |
| `uid` | `user-abc-123` | Integrator-assigned user ID |
| `asn` | `13335` | Entire ASN (e.g., all Cloudflare IPs) |
| `country` | `KP` | ISO 3166-1 alpha-2 country code |

## Decision logic

- **Match found (not expired):** `deny` with score 1.0
- **No match:** `allow` with score 0.0

## When to use

- Block specific IPs or addresses caught abusing the faucet
- Ban entire ASNs known for hosting abuse infrastructure
- Country-level blocks for compliance (sanctions lists)
- Temporary bans with expiry for rate-limit violators
