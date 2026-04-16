# @faucet/abuse-geoip

Geo-IP / ASN abuse layer. Resolves the caller's IP to a country and ASN
and applies allow/deny rules.

Implements `AbuseCheck` from [@faucet/core](../core/) — registered in
[`apps/server/src/abuse/pipeline.ts`](../../apps/server/src/abuse/pipeline.ts).

## Resolvers

Two backends, pick one via `FAUCET_GEOIP_BACKEND`:

- `maxmind` — local MaxMind GeoLite2 `.mmdb` files (fast, offline)
- `ipinfo` — IPinfo API (requires token, network call per claim)
- `none` (default) — disables the layer

## Config

| Env | Purpose |
|-----|---------|
| `FAUCET_GEOIP_BACKEND` | `maxmind` \| `ipinfo` \| `none` |
| `FAUCET_GEOIP_MAXMIND_COUNTRY_DB` | Path to GeoLite2-Country.mmdb |
| `FAUCET_GEOIP_MAXMIND_ASN_DB` | Path to GeoLite2-ASN.mmdb |
| `FAUCET_GEOIP_IPINFO_TOKEN` | IPinfo API token |
| `FAUCET_GEOIP_DENY_COUNTRIES` | CSV of ISO-3166 codes (e.g. `KP,CU,IR`) |
| `FAUCET_GEOIP_ALLOW_COUNTRIES` | CSV allowlist (supersedes deny list) |
| `FAUCET_GEOIP_DENY_ASNS` | CSV of ASN numbers |
| `FAUCET_GEOIP_DENY_VPN` | `true` to block IPinfo-tagged VPNs |
| `FAUCET_GEOIP_DENY_TOR` | `true` to block Tor exits |
| `FAUCET_GEOIP_DENY_HOSTING` | `true` to block datacenter ranges |

## Behaviour

- `deny` if country / ASN / privacy tag matches a deny rule.
- `allow` with signals attached for scoring by downstream layers.
- Fast (<5 ms) with MaxMind; ~100-200 ms with IPinfo.

## See also

- [@faucet/core](../core/) — `AbuseCheck` interface
- [docs/deployment-production.md](../../docs/deployment-production.md) — country-allowlist patterns for regulated markets
