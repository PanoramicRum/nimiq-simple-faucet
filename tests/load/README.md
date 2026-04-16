# Load tests (k6)

## Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) v0.52+ (`brew install k6`).
- A running faucet instance (local Docker, staging, etc.) reachable via
  `FAUCET_URL`.
- For `hashcash.js`: either configure the server with a low difficulty
  (`FAUCET_HASHCASH_DIFFICULTY=8`) or provide
  `tests/load/fixtures/hashcash.json` with pre-solved puzzles.

## Scripts

### `claim.js`

Primary load test for `POST /v1/claim`.

```bash
FAUCET_URL=http://localhost:8080 k6 run tests/load/claim.js
```

Shape: ramp 1 → 50 VUs over 30s, hold 30s, ramp down over 20s.

Metrics to watch:

- `claim_latency` — trend of request duration (ms). Threshold: `p(95) < 1500`.
- `denied_ratio` — share of responses that were `403` or `429`. High values
  here are EXPECTED under load (rate limits / captcha failures) and are NOT
  a test failure.
- `failed_ratio` — rate of 5xx / network / unexpected statuses. Threshold:
  `rate < 0.02`.
- Built-in `http_req_duration{expected_response:true}` — second p95 lens.

Override env: `VUS` (default 50), `HOLD_SECONDS` (default 30).

### `hashcash.js`

Smoke test that exercises the hashcash claim path using pre-solved puzzles.
k6 cannot feasibly solve production-difficulty hashcash challenges in-VU; the
script fails open and logs a warning if no fixtures are present. For real
hashcash load shape, run a dedicated solver harness alongside k6.

```bash
FAUCET_URL=http://localhost:8080 k6 run tests/load/hashcash.js
```

## CI usage

These scripts are expected to run against ephemeral staging environments, not
as part of the PR CI pipeline. Wire them into the release workflow after a
successful deploy to staging:

```bash
k6 run --summary-export=load-report.json tests/load/claim.js
```
