// k6 load test for POST /v1/claim.
//
// Run:
//   FAUCET_URL=http://localhost:8080 k6 run tests/load/claim.js
//
// Env:
//   FAUCET_URL      base URL (required)
//   VUS             peak virtual users (default 50)
//   HOLD_SECONDS    steady-state hold duration (default 30)
//
// Metrics:
//   claim_latency        trend (ms) for all accepted responses
//   denied_ratio         rate of 403 denials (expected > 0, not a failure)
//   p95_latency          summary of p(95) latency exposed via threshold
//
// Thresholds:
//   p(95) latency < 1500ms
//   non-denial failures < 2% (5xx, network, timeouts; 403/429 excluded)

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { randomBytes } from 'k6/crypto';

const BASE_URL = __ENV.FAUCET_URL;
if (!BASE_URL) {
  throw new Error('FAUCET_URL env var is required');
}

const PEAK_VUS = Number(__ENV.VUS || 50);
const HOLD_SECONDS = Number(__ENV.HOLD_SECONDS || 30);

export const claimLatency = new Trend('claim_latency', true);
export const deniedRatio = new Rate('denied_ratio');
export const failedRatio = new Rate('failed_ratio');

export const options = {
  scenarios: {
    ramp_hold: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: PEAK_VUS },
        { duration: `${HOLD_SECONDS}s`, target: PEAK_VUS },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Published SLO — p95 must stay under 1.5s.
    'claim_latency': ['p(95)<1500'],
    // 403 and 429 are EXPECTED under load and are excluded from failure rate;
    // see the `failedRatio.add(...)` call below.
    'failed_ratio': ['rate<0.02'],
    // Explicit summary channel so CI can surface p95 in the trend.
    'http_req_duration{expected_response:true}': ['p(95)<1500'],
  },
};

// 20 random bytes → hex. k6 has no WebCrypto, but randomBytes is deterministic
// enough for load shape. A real Nimiq address would be base32/space-separated;
// /v1/claim should either reject with 400 (validation) or accept with 200.
function randomAddress() {
  const b = randomBytes(20);
  const view = new Uint8Array(b);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  // Nimiq-looking space-separated blocks of 4 hex-chars.
  return `NQ00 ${hex.match(/.{1,4}/g).slice(0, 8).join(' ').toUpperCase()}`;
}

export default function () {
  const url = `${BASE_URL}/v1/claim`;
  const body = JSON.stringify({ address: randomAddress() });
  const params = {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'claim' },
  };

  const res = http.post(url, body, params);
  claimLatency.add(res.timings.duration);

  const denied = res.status === 403 || res.status === 429;
  deniedRatio.add(denied);

  // Only network / 5xx / 400s we didn't expect count as "failed".
  const acceptable = res.status === 200 || res.status === 201 || denied;
  failedRatio.add(!acceptable);

  check(res, {
    'status is 200/201/403/429': (r) =>
      r.status === 200 || r.status === 201 || r.status === 403 || r.status === 429,
  });
}
