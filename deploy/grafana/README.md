# Grafana dashboard

Pre-built dashboard for monitoring the Nimiq Simple Faucet via Prometheus.

## Import

1. Open Grafana → **Dashboards** → **Import**.
2. Upload `nimiq-faucet.json` (or paste its contents).
3. Select your Prometheus datasource when prompted.

## Panels

| Panel | Metric | Type |
|-------|--------|------|
| Claim Rate (5m) | `faucet_claims_total` | stat (req/s) |
| Wallet Balance | `faucet_wallet_balance_luna` | stat (NIM) + timeseries |
| Driver Ready | `faucet_driver_ready` | stat (0/1 with color mapping) |
| Claims by Status + Decision | `faucet_claims_total{status,decision}` | stacked timeseries |
| Claim Latency (p50/p95/p99) | `faucet_claim_duration_seconds` | timeseries (seconds) |
| Reconciler Flips | `faucet_reconciler_flips_total{to}` | timeseries |

## Prerequisites

- Prometheus scraping the faucet's `/metrics` endpoint (default: every 15s).
- `FAUCET_METRICS_ENABLED=true` (the default since v1.4.0).
