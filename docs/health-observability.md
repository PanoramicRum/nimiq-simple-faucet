# Health & observability

This doc covers what to monitor once your faucet is running, and how to
alert on things that matter.

The faucet exposes two complementary HTTP endpoints — pick the right
one for the right Kubernetes probe:

| Endpoint | Probe role | Cost | Failure semantics |
|----------|------------|------|-------------------|
| `/healthz` | Liveness — "is the process alive?" | < 1 ms, no I/O | 503 → restart the pod |
| `/readyz` | Readiness — "are dependencies healthy?" | one DB query + one Redis ping + one balance read | 503 → stop routing traffic to this pod |

The Helm chart wires this correctly out of the box ([`deploy/helm/values.yaml`](../deploy/helm/values.yaml) — `livenessProbe.httpGet.path: /healthz`, `readinessProbe.httpGet.path: /readyz`).

## `/healthz` — liveness only

The handler at [`apps/server/src/app.ts`](../apps/server/src/app.ts) is one line:

```ts
app.get('/healthz', async () => ({ ok: true }));
```

A 200 response means the HTTP listener is up, the event loop isn't blocked, and config validation passed at boot. It does **not** verify database reachability, driver connectivity, or Redis availability.

This is deliberate — the `livenessProbe` should restart only when the process is truly wedged. An upstream-node hiccup or a transient Redis blip is a `/readyz` problem (stop routing traffic), not a `/healthz` problem (restart the pod).

## `/readyz` — dependency-chain probe

`GET /readyz` returns `{ ready: bool, checks: { ... } }`. A 200 means every mandatory check passed; a 503 means at least one check failed and Kubernetes should stop routing traffic until the issue clears.

| `checks.<key>` | Mandatory? | Fails the probe when… |
|---|---|---|
| `driver` | yes | The signer driver hasn't completed initial handshake / consensus |
| `db` | yes | `SELECT 1` against the configured SQLite/Postgres backing store fails |
| `redis` | when `REDIS_URL` is set | The Redis client's `PING` errors or doesn't respond within 1 s |
| `balance` | when `FAUCET_MIN_BALANCE_LUNA` is set | Wallet balance falls below the configured threshold |
| `geoip` | never (degraded signal) | GeoIP DB is stale — surfaced for alerting but does **not** flip the probe |

**Why opt-in?** `redis` and `balance` only fail-close when the operator has explicitly opted in (set `REDIS_URL` / `FAUCET_MIN_BALANCE_LUNA`). Single-instance deployments and unfunded test wallets don't get unexpected 503s — preserving the original §1.0 behavior.

### Recommended thresholds

```bash
# Set to ~10× your per-claim amount so /readyz trips before you run dry
FAUCET_MIN_BALANCE_LUNA=$(( $FAUCET_CLAIM_AMOUNT_LUNA * 10 ))
```

The faucet still serves 503s for several minutes before the wallet actually empties (claims-in-flight finish; Kubernetes drains traffic), so 10× the per-claim amount is a generous floor.

### Sample 503 response

```json
{
  "ready": false,
  "checks": {
    "driver": "ok",
    "db": "ok",
    "redis": "error: ECONNREFUSED",
    "balance": "1234567 (below FAUCET_MIN_BALANCE_LUNA=10000000)",
    "geoip": "ok (dbip, 7d old)"
  }
}
```

`Retry-After: 10` is set on every 503 so well-behaved clients back off.

## What to monitor (external)

Since `/healthz` is minimal, your monitoring stack should poll the data
plane directly:

### 1. Uptime — `GET /healthz`

- Expected: HTTP 200, `{"ok":true}` within < 500 ms
- Alert: 3 consecutive failures over 1 minute
- Why: catches pod crashes, OOMs, TLS cert problems

### 2. Config sanity — `GET /v1/config`

- Expected: HTTP 200, `network` matches what you deployed (main vs test)
- Alert: non-200, or `network` flips unexpectedly
- Why: catches misconfigured rollouts

### 3. Claim success rate — `GET /v1/stats`

- Returns the last 100 claims with their `status` distribution
- Watch the ratio of `confirmed` to `rejected` + `broadcast` (stuck)
- Alert: confirmed ratio drops below 80% over a 15-minute window
- Why: catches upstream RPC / WASM consensus issues, funding depletion

### 4. Balance — admin API `GET /admin/account`

- Requires admin session cookie
- Returns current faucet wallet balance in luna
- Alert: balance < `claimAmountLuna * 1000` (pick a threshold that gives
  you time to refill before you run dry)
- Why: the single most important faucet-specific metric. A dry faucet
  silently rejects every claim.

### 5. Admin login rate limit

- `/admin/auth/login` returns 429 under brute-force
- Alert: sustained 429s for > 5 minutes
- Why: likely credential-stuffing attempt

---

## Log signals worth alerting on

The server uses pino (default level `info`). Ship logs to your stack of
choice (Loki, CloudWatch, Datadog, …). Notable patterns to watch:

| Log message | Meaning | Action |
|-------------|---------|--------|
| `confirmation failed` | Claim sent, but waitForConfirmation timed out / errored. Claim stays at `broadcast`. | Investigate node health; usually transient. |
| `RPC_HTTP_ERROR` | Upstream Nimiq node returned >= 400 | Check node uptime |
| `integrator auth failed` | Someone tried HMAC-signing with bad creds | If sustained from one integrator, their clock is skewed or their secret rotated |
| `claim rejected: geo-blocked` | Geo-IP layer denied | Expected noise; alert only on sudden ramps (possible legit region misconfig) |
| `FATAL` | Startup error | Pod will crashloop; fix config and redeploy |

Structured fields to index on:

- `req.id` — correlation across a request's lifecycle
- `claimId` — if you need to trace a specific claim through the pipeline
- `integratorId` — per-integrator error rates

---

## Dashboards (manual until the `/metrics` endpoint ships)

A proper Prometheus `/metrics` endpoint is on the [roadmap](../ROADMAP.md).
Until then, build dashboards from:

1. **Access logs** — RPS, p50/p95/p99 latency on `/v1/claim`, `/v1/config`, `/healthz`
2. **Polling `/v1/stats`** every 30s and emitting gauges for `byStatus`/`byDecision` distributions
3. **Polling `/admin/overview`** (authenticated) for balance and recent claim/hour
4. **Pod CPU/memory** from kube-state-metrics or equivalent

Suggested Grafana panels:

- Claim success rate (stacked area of confirmed/rejected/broadcast over time)
- Faucet balance (single-stat with threshold coloring)
- Abuse decisions per hour (grouped bar by deny/challenge/review/allow)
- P95 claim latency (line graph)

---

## Alert response playbook

- **Balance low** → fund the faucet wallet from your treasury address
- **Confirmation failures spike** → check the Nimiq node's own logs; often
  a seed-peer issue that self-heals. If it doesn't, cycle the pod.
- **Claims all rejected** → check `/v1/config` — did abuse layers change?
  Check admin audit log for recent config changes.
- **Admin can't log in** → TOTP device out of sync or admin user wiped.
  Recovery path requires shell access to the pod and a SQL update;
  document this per your operator runbook. (Next.js/auth style helpers
  are on the roadmap.)

---

## See also

- [deployment-production.md](./deployment-production.md) — full deploy runbook
- [../deploy/helm/values.yaml](../deploy/helm/values.yaml) — Helm probe config (uses `/healthz` for liveness, `/readyz` for readiness)
- [../apps/server/src/app.ts](../apps/server/src/app.ts) — actual `/healthz` + `/readyz` handler source
- [../apps/server/test/readiness.e2e.test.ts](../apps/server/test/readiness.e2e.test.ts) — end-to-end test of every check
