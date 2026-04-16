# Configuration

All configuration is environment-variable driven. Defaults are production-safe
except where noted. The canonical list lives in `.env.example` at the repo
root; this page groups it by concern.

## Network and signer

| Variable | Default | Notes |
| --- | --- | --- |
| `FAUCET_NETWORK` | `test` | `main` or `test`. |
| `FAUCET_SIGNER_DRIVER` | `rpc` | `rpc` (talks to a Nimiq node) or `wasm` (in-process signer). |

### RPC driver

| Variable | Notes |
| --- | --- |
| `FAUCET_RPC_URL` | HTTP(S) URL of the Nimiq RPC endpoint. |
| `FAUCET_RPC_USERNAME` | Optional basic-auth. |
| `FAUCET_RPC_PASSWORD` | Optional basic-auth. |
| `FAUCET_WALLET_ADDRESS` | Faucet wallet, human-readable `NQ...` form. |
| `FAUCET_WALLET_PASSPHRASE` | Unlocks the RPC wallet if set. |

### WASM driver

| Variable | Notes |
| --- | --- |
| `FAUCET_PRIVATE_KEY` | Hex key or 24-word seed. |
| `FAUCET_KEY_PASSPHRASE` | At least 8 characters; encrypts the on-disk keyring. |

## Claim amount and rate limits

| Variable | Default | Notes |
| --- | --- | --- |
| `FAUCET_CLAIM_AMOUNT_LUNA` | `100000` | 1 NIM = 100,000 luna. |
| `FAUCET_RATE_LIMIT_PER_MINUTE` | `30` | Global per-minute cap. |
| `FAUCET_RATE_LIMIT_PER_IP_PER_DAY` | `5` | Per-IP daily cap. |

## Captcha

Set exactly one provider (or none and rely on hashcash).

| Variable | Notes |
| --- | --- |
| `FAUCET_TURNSTILE_SITE_KEY` / `FAUCET_TURNSTILE_SECRET` | Cloudflare Turnstile. |
| `FAUCET_HCAPTCHA_SITE_KEY` / `FAUCET_HCAPTCHA_SECRET` | hCaptcha. |

## Hashcash (client puzzle)

Self-hosted SHA-256 anti-bot fallback; unrelated to Nimiq's PoS consensus.

| Variable | Default | Notes |
| --- | --- | --- |
| `FAUCET_HASHCASH_SECRET` | unset | Enables the layer when set; use ≥16 random chars. |
| `FAUCET_HASHCASH_DIFFICULTY` | `20` | Leading zero bits. 20 ≈ 1M hashes. |
| `FAUCET_HASHCASH_TTL_MS` | `300000` | Challenge lifetime. |

## Geo-IP, ASN, VPN, datacenter filters

| Variable | Notes |
| --- | --- |
| `FAUCET_GEOIP_BACKEND` | `none` (default), `maxmind`, or `ipinfo`. |
| `FAUCET_GEOIP_MAXMIND_COUNTRY_DB` | Path to `GeoLite2-Country.mmdb`. |
| `FAUCET_GEOIP_MAXMIND_ASN_DB` | Path to `GeoLite2-ASN.mmdb`. |
| `FAUCET_GEOIP_IPINFO_TOKEN` | IPinfo API token. |
| `FAUCET_GEOIP_DENY_COUNTRIES` | Comma-separated ISO alpha-2. Deny wins over allow. |
| `FAUCET_GEOIP_ALLOW_COUNTRIES` | When set, all other countries are denied. |
| `FAUCET_GEOIP_DENY_ASNS` | Comma-separated ASN numbers. |
| `FAUCET_GEOIP_DENY_VPN` | `true` denies when the ASN org matches a VPN heuristic. |
| `FAUCET_GEOIP_DENY_TOR` | `true` denies Tor exit IPs. |
| `FAUCET_GEOIP_DENY_HOSTING` | `true` denies common hosting providers (AWS, DO, Hetzner, ...). |

## Admin and dashboard

| Variable | Notes |
| --- | --- |
| `FAUCET_ADMIN_PASSWORD` | At least 8 characters. Required. |
| `FAUCET_ADMIN_TOTP_SECRET` | Generated on first login if absent; provisioning URI is returned once. |
| `FAUCET_ADMIN_SESSION_TTL_MS` | Session cookie lifetime (default 8h). |
| `FAUCET_ADMIN_TOTP_STEP_UP_TTL_MS` | Sensitive-action TOTP re-auth window (default 2m). |
| `FAUCET_KEYRING_PATH` | XChaCha20-Poly1305 encrypted key blob with argon2id/scrypt KDF. |

## Integrator keys

Server-to-server HMAC credentials for partners that sign `hostContext`:

```bash
FAUCET_INTEGRATOR_KEYS=demo:key_abc123:secret_xyz789,partner2:key_def:secret_uvw
```

## Storage

| Variable | Default | Notes |
| --- | --- | --- |
| `FAUCET_DATA_DIR` | `/data` | SQLite + keyring location. |
| `DATABASE_URL` | unset | Leave unset for SQLite (the only supported backend on 1.0.x). Postgres support is planned — see [ROADMAP.md §1.3.x](../../../ROADMAP.md). |
| `REDIS_URL` | unset | Leave unset for in-memory rate limiting. Redis-backed shared state ships with Postgres support. |

## Security hardening

| Variable | Default | Notes |
| --- | --- | --- |
| `FAUCET_TLS_REQUIRED` | `true` | Server refuses plain HTTP unless `FAUCET_DEV=1`. |
| `FAUCET_HELMET_CSP` | `relaxed-for-ui` | `strict`, `relaxed-for-ui`, or `off`. |
| `FAUCET_CORS_ORIGINS` | `*` | `*` or comma-separated list. |
| `FAUCET_DEV` | `false` | Disables TLS enforcement and tightens other checks. |
