# GeoIP / ASN / VPN / Datacenter Detection

Geo-IP layer that resolves the caller's IP address to country and ASN, then applies configurable allow/deny rules. Supports multiple pluggable providers for IP resolution.

## How it works

1. The caller's IP is resolved to a country code, ASN number, and privacy flags (VPN, Tor, hosting/datacenter)
2. The resolved data is checked against the configured rules:
   - Country allowlist/denylist
   - ASN denylist
   - VPN / Tor / datacenter flags
3. If any rule matches, the claim is denied. Otherwise, the signals are passed to downstream layers for scoring.

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `FAUCET_GEOIP_BACKEND` | `dbip` | Provider: `dbip`, `maxmind`, `ipinfo`, or `none` |
| `FAUCET_GEOIP_DENY_COUNTRIES` | _(unset)_ | CSV of ISO 3166-1 codes to deny (e.g., `KP,CU,IR`) |
| `FAUCET_GEOIP_ALLOW_COUNTRIES` | _(unset)_ | CSV of codes to allow (supersedes deny list) |
| `FAUCET_GEOIP_DENY_ASNS` | _(unset)_ | CSV of ASN numbers to deny |
| `FAUCET_GEOIP_DENY_VPN` | `false` | Block known VPN IP ranges |
| `FAUCET_GEOIP_DENY_TOR` | `false` | Block Tor exit nodes |
| `FAUCET_GEOIP_DENY_HOSTING` | `false` | Block datacenter/hosting IP ranges |

### Provider-specific config

| Env var | Provider | Description |
|---------|----------|-------------|
| `FAUCET_GEOIP_MAXMIND_COUNTRY_DB` | MaxMind | Path to `GeoLite2-Country.mmdb` |
| `FAUCET_GEOIP_MAXMIND_ASN_DB` | MaxMind | Path to `GeoLite2-ASN.mmdb` |
| `FAUCET_GEOIP_IPINFO_TOKEN` | IPinfo | API token for IPinfo |

## Providers

### DB-IP (default)

- **Cost:** Free (embedded in `@ip-location-db/dbip-*` npm packages)
- **Speed:** <5ms (local lookup)
- **Accuracy:** Good for country-level; limited ASN data
- **VPN/Tor detection:** Basic
- **Setup:** Zero config — works out of the box
- **Attribution required:** "IP geolocation by DB-IP (https://db-ip.com)"

### MaxMind GeoLite2

- **Cost:** Free with account (GeoLite2 license key required)
- **Speed:** <5ms (local .mmdb file lookup)
- **Accuracy:** Industry standard; excellent country + ASN data
- **VPN/Tor detection:** Available in GeoIP2 (paid) tier
- **Setup:** Download `.mmdb` files, set `FAUCET_GEOIP_MAXMIND_COUNTRY_DB` and `FAUCET_GEOIP_MAXMIND_ASN_DB`
- **Update schedule:** Weekly DB updates recommended

### IPinfo

- **Cost:** Free tier (50k lookups/month); paid plans available
- **Speed:** ~100-200ms (network API call per claim)
- **Accuracy:** Excellent; includes VPN, proxy, Tor, relay, and hosting detection
- **Setup:** Set `FAUCET_GEOIP_IPINFO_TOKEN`
- **Best for:** Operators who need VPN/Tor detection without MaxMind GeoIP2 paid tier

## Decision logic

- **Country/ASN/VPN/Tor/hosting match:** `deny` with specific reason
- **No match:** `allow` with country + ASN signals for downstream scoring

## Trade-offs

- **Most impactful layer** for reducing abuse from VPNs and datacenters
- **Country allowlist** is the strongest approach — only allow your target regions
- **False positives** possible with VPN detection (legitimate users behind corporate VPNs)
- DB-IP is free but less accurate than MaxMind for edge cases
