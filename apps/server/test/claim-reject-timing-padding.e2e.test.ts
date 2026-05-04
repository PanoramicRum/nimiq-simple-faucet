// Verifies the constant-time reject-delivery contract from
// audits/findings-2026-05/024 — every public claim-reject path is padded
// to at least `rejectDelayMsMin` so an attacker can't infer which abuse
// layer fired by timing the response.
//
// Body uniformity (PR #176) is necessary but not sufficient — the pipeline
// short-circuits on hard `deny`, so without padding a rate-limit reject
// returns in ~5ms while a captcha or AI reject takes hundreds of ms. This
// test enables padding and asserts every reject path waits the floor.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const USER_ADDR = 'NQ00 7777 7777 7777 7777 7777 7777 7777 7777';

class FakeDriver extends BaseTestDriver {
  override async getBalance() {
    return 10_000_000n;
  }
  override async send(): Promise<string> {
    return 'tx_unused';
  }
}

// Use a small floor (200ms) so the test runs quickly while still being
// large enough to be observable above scheduler noise. Production default
// is 1500ms — but the contract under test is "elapsed >= configured floor",
// not "elapsed >= some specific large number".
const TEST_T_MIN = 200;

describe('public claim-reject paths pad to rejectDelayMsMin', () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-reject-timing-'));
    const config = ServerConfigSchema.parse({
      geoipBackend: 'none',
      network: 'test',
      dataDir: tmp,
      signerDriver: 'rpc',
      rpcUrl: 'http://unused',
      walletAddress: FAUCET_ADDR,
      claimAmountLuna: '100000',
      // Tight per-IP cap so we can trip rate-limit deny in 2 calls.
      rateLimitPerIpPerDay: '1',
      adminPassword: 'test-password-123',
      dev: 'true',
      rejectDelayMsMin: String(TEST_T_MIN),
    });
    const built = await buildApp(config, { driverOverride: new FakeDriver(), quietLogs: true });
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  async function timed(injectArgs: Parameters<typeof app.inject>[0]): Promise<{ elapsed: number; statusCode: number }> {
    const t0 = Date.now();
    const r = await app.inject(injectArgs);
    return { elapsed: Date.now() - t0, statusCode: r.statusCode };
  }

  it('Zod-invalid request (400) waits >= rejectDelayMsMin', async () => {
    const { elapsed, statusCode } = await timed({
      method: 'POST',
      url: '/v1/claim',
      payload: { not_an_address: 'totally bogus' },
      headers: { 'content-type': 'application/json' },
    });
    expect(statusCode).toBe(400);
    expect(elapsed).toBeGreaterThanOrEqual(TEST_T_MIN);
  });

  it('invalid-address (400) waits >= rejectDelayMsMin', async () => {
    const { elapsed, statusCode } = await timed({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: 'this is not a NQ address' },
      headers: { 'content-type': 'application/json' },
    });
    expect(statusCode).toBe(400);
    expect(elapsed).toBeGreaterThanOrEqual(TEST_T_MIN);
  });

  it('integrator-auth-failed (401) waits >= rejectDelayMsMin', async () => {
    const { elapsed, statusCode } = await timed({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR },
      headers: {
        'content-type': 'application/json',
        'x-faucet-api-key': 'bogus-key-not-registered',
        'x-faucet-timestamp': String(Date.now()),
        'x-faucet-nonce': 'abc123',
        'x-faucet-signature': 'invalid',
      },
    });
    expect(statusCode).toBe(401);
    expect(elapsed).toBeGreaterThanOrEqual(TEST_T_MIN);
  });

  it('rate-limit deny (403) waits >= rejectDelayMsMin', async () => {
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.99' };
    // First claim consumes the daily quota.
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR },
      headers,
    });
    expect(ok.statusCode).toBe(200);
    // Second claim trips deny — should be padded.
    const { elapsed, statusCode } = await timed({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR.replace('7777', '6666') },
      headers,
    });
    expect(statusCode).toBe(403);
    expect(elapsed).toBeGreaterThanOrEqual(TEST_T_MIN);
  });
});
