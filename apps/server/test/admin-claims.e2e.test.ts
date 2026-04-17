import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS, parseCookie } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const USER_ADDR = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';

class FakeDriver extends BaseTestDriver {
  public sends: Array<{ to: string; amount: bigint }> = [];
  override async getBalance() { return 10_000_000n; }
  override async send(to: string, amount: bigint) {
    this.sends.push({ to, amount });
    return `tx_${this.sends.length}`;
  }
}

let sharedAuth: { session: string; csrf: string } | undefined;
async function login(app: Awaited<ReturnType<typeof buildApp>>['app']): Promise<{ session: string; csrf: string }> {
  if (sharedAuth) return sharedAuth;
  const seed = await app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    payload: { password: 'test-password-123' },
    headers: { 'content-type': 'application/json' },
  });
  sharedAuth = {
    session: parseCookie(seed.headers['set-cookie'], 'faucet_session')!,
    csrf: parseCookie(seed.headers['set-cookie'], 'faucet_csrf')!,
  };
  return sharedAuth;
}

describe('admin claims', () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-admin-claims-'));
    const config = ServerConfigSchema.parse({ geoipBackend: "none",
      network: 'test',
      dataDir: tmp,
      signerDriver: 'rpc',
      rpcUrl: 'http://unused',
      walletAddress: FAUCET_ADDR,
      claimAmountLuna: '100000',
      rateLimitPerIpPerDay: '100',
      adminPassword: 'test-password-123',
      dev: 'true',
    });
    const built = await buildApp(config, { driverOverride: new FakeDriver(), quietLogs: true });
    app = built.app;
    await app.ready();
    // Seed a few claims.
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/v1/claim',
        payload: { address: USER_ADDR },
        headers: { 'content-type': 'application/json' },
      });
    }
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('lists claims with pagination and filter', async () => {
    const { session } = await login(app);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/claims?limit=10',
      cookies: { faucet_session: session },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);

    const filtered = await app.inject({
      method: 'GET',
      url: `/admin/claims?address=${encodeURIComponent(USER_ADDR)}`,
      cookies: { faucet_session: session },
    });
    expect(filtered.statusCode).toBe(200);
    for (const item of filtered.json().items) {
      expect(item.address).toBe(USER_ADDR);
    }
  });

  it('returns full signals via /admin/claims/:id/explain', async () => {
    const { session } = await login(app);
    const list = await app.inject({
      method: 'GET',
      url: '/admin/claims?limit=1',
      cookies: { faucet_session: session },
    });
    const id = list.json().items[0].id as string;
    const res = await app.inject({
      method: 'GET',
      url: `/admin/claims/${id}/explain`,
      cookies: { faucet_session: session },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(id);
    expect(body.signals).toBeDefined();
    expect(typeof body.signals).toBe('object');
  });

  it('manual deny flips status and writes an audit entry', async () => {
    const { session, csrf } = await login(app);
    const list = await app.inject({
      method: 'GET',
      url: '/admin/claims?limit=1',
      cookies: { faucet_session: session },
    });
    const id = list.json().items[0].id as string;

    const denied = await app.inject({
      method: 'POST',
      url: `/admin/claims/${id}/deny`,
      payload: { reason: 'test-deny' },
      headers: { 'content-type': 'application/json', 'x-faucet-csrf': csrf },
      cookies: { faucet_session: session, faucet_csrf: csrf },
    });
    expect(denied.statusCode).toBe(200);

    const explain = await app.inject({
      method: 'GET',
      url: `/admin/claims/${id}/explain`,
      cookies: { faucet_session: session },
    });
    expect(explain.json().status).toBe('rejected');
    expect(explain.json().decision).toBe('deny');
    expect(explain.json().rejectionReason).toBe('test-deny');

    const audit = await app.inject({
      method: 'GET',
      url: '/admin/audit-log?limit=20',
      cookies: { faucet_session: session },
    });
    expect(audit.statusCode).toBe(200);
    const hits = (audit.json().items as Array<{ action: string; target: string }>).filter(
      (r) => r.action === 'claim.deny' && r.target === id,
    );
    expect(hits.length).toBe(1);
  });

  it('manual allow flips status', async () => {
    const { session, csrf } = await login(app);
    const list = await app.inject({
      method: 'GET',
      url: '/admin/claims?limit=1',
      cookies: { faucet_session: session },
    });
    const id = list.json().items[0].id as string;
    const allowed = await app.inject({
      method: 'POST',
      url: `/admin/claims/${id}/allow`,
      payload: {},
      headers: { 'content-type': 'application/json', 'x-faucet-csrf': csrf },
      cookies: { faucet_session: session, faucet_csrf: csrf },
    });
    expect(allowed.statusCode).toBe(200);
    const explain = await app.inject({
      method: 'GET',
      url: `/admin/claims/${id}/explain`,
      cookies: { faucet_session: session },
    });
    expect(explain.json().decision).toBe('allow');
    expect(explain.json().status).toBe('manual-allow');
  });

  it('mutating route without CSRF is rejected', async () => {
    const { session } = await login(app);
    const list = await app.inject({
      method: 'GET',
      url: '/admin/claims?limit=1',
      cookies: { faucet_session: session },
    });
    const id = list.json().items[0].id as string;
    const res = await app.inject({
      method: 'POST',
      url: `/admin/claims/${id}/deny`,
      payload: {},
      headers: { 'content-type': 'application/json' },
      cookies: { faucet_session: session },
    });
    expect(res.statusCode).toBe(403);
  });
});
