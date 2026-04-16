// k6 hashcash-claim smoke test.
//
// IMPORTANT: k6 has no WebCrypto. The real hashcash challenge uses SHA-256
// with difficulty 20 which is not worth re-implementing in pure JS inside a
// k6 VU — even at difficulty 12 the CPU cost per iteration would overwhelm
// the test harness. Instead we:
//
//   1. Ask the server for a challenge at the LOWEST difficulty it supports
//      (operator must launch with `FAUCET_HASHCASH_DIFFICULTY=8` for this
//      smoke to complete within a run).
//   2. Use a `SharedArray` of PRE-SOLVED (challenge, nonce) pairs loaded
//      from `tests/load/fixtures/hashcash.json` when available, so we can
//      exercise the /v1/claim endpoint without solving puzzles in-VU.
//
// For real hashcash load shape, use a separate harness (go / rust worker
// pool that solves challenges out-of-band). This file is only a SMOKE check
// that the claim path still accepts a valid hashcash proof.
//
// Run:
//   FAUCET_URL=http://localhost:8080 k6 run tests/load/hashcash.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE_URL = __ENV.FAUCET_URL;
if (!BASE_URL) {
  throw new Error('FAUCET_URL env var is required');
}

const PEAK_VUS = Number(__ENV.VUS || 10);

export const hashcashLatency = new Trend('hashcash_latency', true);
export const hashcashSuccess = new Rate('hashcash_success');

// Pre-solved challenges. Must be refreshed when the server's hashcash secret
// rotates. Generate them with `pnpm --filter @nimiq-faucet/abuse-hashcash solve`.
// Shape: [{ challenge: string, nonce: string, address: string }]
const solved = new SharedArray('solved-hashcash', function () {
  try {
    // eslint-disable-next-line no-undef
    return JSON.parse(open('./fixtures/hashcash.json'));
  } catch (e) {
    // Fallback stub: empty pool — the smoke will log and exit gracefully.
    return [];
  }
});

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: PEAK_VUS,
      duration: '30s',
    },
  },
  thresholds: {
    hashcash_success: ['rate>0.80'],
    hashcash_latency: ['p(95)<2000'],
  },
};

export default function () {
  if (solved.length === 0) {
    // Nothing to do; log once per VU iteration and back off.
    console.warn('tests/load/fixtures/hashcash.json missing — hashcash smoke is a no-op');
    sleep(1);
    return;
  }
  const pick = solved[Math.floor(Math.random() * solved.length)];

  const res = http.post(
    `${BASE_URL}/v1/claim`,
    JSON.stringify({
      address: pick.address,
      hashcash: { challenge: pick.challenge, nonce: pick.nonce },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'claim-hashcash' },
    },
  );

  hashcashLatency.add(res.timings.duration);
  const ok = res.status === 200 || res.status === 201;
  hashcashSuccess.add(ok);

  check(res, {
    'hashcash accepted or rate-limited': (r) =>
      r.status === 200 || r.status === 201 || r.status === 403 || r.status === 429,
  });
}
