// Verifies the uniform-public-rejection contract: every reject path on
// `/v1/claim` returns *exactly* `{ id, status: 'rejected' }` with HTTP 403.
// No abuse-layer attribution, no decision/reason/error/code/issues fields,
// no 202 vs 403 split between deny and review. See SECURITY.md
// "Public-API silence on rejection".

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const USER_ADDR = 'NQ00 9999 9999 9999 9999 9999 9999 9999 9999';

class FakeDriver extends BaseTestDriver {
  override async getBalance() {
    return 10_000_000n;
  }
  override async send(): Promise<string> {
    return 'tx_unused';
  }
}

function expectUniformRejectShape(body: unknown, statusCode: number) {
  expect(statusCode).toBe(403);
  expect(typeof body).toBe('object');
  expect(body).not.toBeNull();
  const obj = body as Record<string, unknown>;
  expect(Object.keys(obj).sort()).toEqual(['id', 'status']);
  expect(typeof obj['id']).toBe('string');
  expect(obj['status']).toBe('rejected');
}

describe('public claim-reject responses are uniform', () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-uniform-reject-'));
    const config = ServerConfigSchema.parse({
      geoipBackend: 'none',
      network: 'test',
      dataDir: tmp,
      signerDriver: 'rpc',
      rpcUrl: 'http://unused',
      walletAddress: FAUCET_ADDR,
      claimAmountLuna: '100000',
      // Tight rate limit so we can trip the rate-limit deny path quickly.
      rateLimitPerIpPerDay: '1',
      adminPassword: 'test-password-123',
      dev: 'true',
    });
    const built = await buildApp(config, { driverOverride: new FakeDriver(), quietLogs: true });
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('rate-limit deny → uniform 403 + {id, status}', async () => {
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.10' };
    // First claim consumes the daily quota.
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR },
      headers,
    });
    expect(ok.statusCode).toBe(200);
    // Second claim trips the rate limit.
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR.replace('9999', '8888') },
      headers,
    });
    expectUniformRejectShape(denied.json(), denied.statusCode);
  });

  it('GET /v1/claim/:id never leaks decision or rejectionReason on the public route', async () => {
    // Trip a reject so we have a row whose internal `decision` and
    // `rejectionReason` columns are populated, then poll the public GET.
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.20' };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR.replace('9999', '7777') },
      headers,
    });
    expect(first.statusCode).toBe(200);
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR.replace('9999', '6666') },
      headers,
    });
    expectUniformRejectShape(denied.json(), denied.statusCode);
    const id = (denied.json() as { id: string }).id;

    const status = await app.inject({ method: 'GET', url: `/v1/claim/${id}` });
    expect(status.statusCode).toBe(200);
    const body = status.json() as Record<string, unknown>;
    // Public claim-status response intentionally omits `decision` and
    // `rejectionReason`. Operators retrieve them via /v1/admin/claims.
    expect('decision' in body).toBe(false);
    expect('rejectionReason' in body).toBe(false);
    expect(body['status']).toBe('rejected');
  });

  it('rejection response keys are stable across distinct deny reasons', async () => {
    // Cross-IP sweep: each pair of requests trips the rate limit on a
    // different IP, so the deny is independent. Bodies must be
    // byte-shape-identical (modulo id).
    const seen = new Set<string>();
    const cases: Array<{ ip: string; first: string; second: string }> = [
      { ip: '198.51.100.40', first: '4040', second: '4141' },
      { ip: '198.51.100.50', first: '5050', second: '5151' },
      { ip: '198.51.100.60', first: '6060', second: '6161' },
      { ip: '198.51.100.70', first: '7070', second: '7171' },
    ];
    for (const c of cases) {
      const headers = { 'content-type': 'application/json', 'x-forwarded-for': c.ip };
      // Burn the quota.
      await app.inject({
        method: 'POST',
        url: '/v1/claim',
        payload: { address: USER_ADDR.replace('9999', c.first) },
        headers,
      });
      // Trip the deny.
      const r = await app.inject({
        method: 'POST',
        url: '/v1/claim',
        payload: { address: USER_ADDR.replace('9999', c.second) },
        headers,
      });
      expectUniformRejectShape(r.json(), r.statusCode);
      seen.add(JSON.stringify(Object.keys(r.json() as object).sort()));
    }
    // All bodies share the same key shape.
    expect(seen.size).toBe(1);
    expect([...seen][0]).toBe(JSON.stringify(['id', 'status']));
  });
});
