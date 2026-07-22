import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS, parseCookie } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const ADMIN_PASSWORD = 'test-password-123';
const A1 = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';
const A2 = 'NQ00 2222 2222 2222 2222 2222 2222 2222 2222';

class FakeNimiqDriver extends BaseTestDriver {
  public sends: Array<{ to: string; amount: bigint }> = [];
  public balance = 100_000_000n;
  override async getBalance() {
    return this.balance;
  }
  override async send(to: string, amount: bigint): Promise<string> {
    this.sends.push({ to, amount });
    this.balance -= amount;
    return `tx_${this.sends.length}`;
  }
  override async waitForConfirmation(): Promise<void> {}
}

const open: Array<{ app: FastifyInstance; tmp: string }> = [];

async function makeApp(
  overrides: Record<string, unknown> = {},
  driver: FakeNimiqDriver = new FakeNimiqDriver(),
): Promise<{ app: FastifyInstance; driver: FakeNimiqDriver }> {
  const tmp = mkdtempSync(join(tmpdir(), 'faucet-whitelist-e2e-'));
  const config = ServerConfigSchema.parse({
    geoipBackend: 'none',
    network: 'test',
    dataDir: tmp,
    signerDriver: 'rpc',
    rpcUrl: 'http://unused',
    walletAddress: FAUCET_ADDR,
    claimAmountLuna: '100000',
    rateLimitPerIpPerDay: '100',
    adminPassword: ADMIN_PASSWORD,
    automaticRewardsEnabled: 'true',
    automaticRewardsBaselineNim: '10', // 1_000_000 luna baseline
    whitelistRewardsEnabled: 'true',
    whitelistBonusPercent: '50',
    dev: 'true',
    rejectDelayMsMin: '0',
    // dev mode trusts loopback XFF, so tests can vary the client IP.
    ...overrides,
  });
  const { app } = await buildApp(config, { driverOverride: driver, quietLogs: true });
  await app.ready();
  open.push({ app, tmp });
  return { app, driver };
}

function claim(app: FastifyInstance, address: string, ip: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/claim',
    payload: { address },
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

async function login(app: FastifyInstance): Promise<{ session: string; csrf: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    payload: { password: ADMIN_PASSWORD },
    headers: { 'content-type': 'application/json' },
  });
  return {
    session: parseCookie(res.headers['set-cookie'], 'faucet_session')!,
    csrf: parseCookie(res.headers['set-cookie'], 'faucet_csrf')!,
  };
}

function adminReq(
  app: FastifyInstance,
  auth: { session: string; csrf: string },
  method: 'POST' | 'PATCH' | 'DELETE' | 'GET',
  url: string,
  body?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    ...(body !== undefined ? { payload: body } : {}),
    headers: {
      // Only claim a JSON body when there is one — Fastify 400s on an
      // empty body with a JSON content-type (e.g. the DELETE below).
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'x-faucet-csrf': auth.csrf,
    },
    cookies: { faucet_session: auth.session, faucet_csrf: auth.csrf },
  });
}

afterEach(async () => {
  for (const { app, tmp } of open.splice(0)) {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

describe('whitelist bonus (§2.4.5)', () => {
  it('pays the global default bonus to a listed address (normalized on insert)', async () => {
    const { app, driver } = await makeApp();
    const auth = await login(app);
    // Lowercase, messy spacing — the write path canonicalizes.
    const created = await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1.toLowerCase(),
    });
    expect(created.statusCode).toBe(201);

    const res = await claim(app, A1, '10.0.0.1');
    expect(res.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_500_000n); // baseline + 50% global default

    // A non-listed address pays the plain baseline.
    const res2 = await claim(app, A2, '10.0.0.2');
    expect(res2.statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(1_000_000n);
  });

  it('per-entry percent and exact amount override the global default', async () => {
    const { app, driver } = await makeApp();
    const auth = await login(app);
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1,
      bonusPercent: 20,
    });
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A2,
      exactAmountNim: 25,
    });

    const r1 = await claim(app, A1, '10.0.0.1');
    expect(r1.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_200_000n); // per-entry 20%, not global 50%

    const r2 = await claim(app, A2, '10.0.0.2');
    expect(r2.statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(2_500_000n); // exact 25 NIM
  });

  it('a whitelist grant suppresses the first-time boost', async () => {
    const { app, driver } = await makeApp({ firstTimeBoostPercent: '100' });
    const auth = await login(app);
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', { kind: 'address', value: A1 });

    // Listed first-timer: whitelist bonus (50%) wins over the 100% boost.
    const r1 = await claim(app, A1, '10.0.0.1');
    expect(r1.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_500_000n);

    // Non-listed first-timer still gets the first-time boost.
    const r2 = await claim(app, A2, '10.0.0.2');
    expect(r2.statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(2_000_000n);
  });

  it('the toggle is a live kill switch and /v1/config stays at the baseline', async () => {
    const { app, driver } = await makeApp();
    const auth = await login(app);
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', { kind: 'address', value: A1 });

    // Public config never leaks per-claimant bonuses.
    const pub = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(pub.json().claimAmountLuna).toBe('1000000');

    const r1 = await claim(app, A1, '10.0.0.1');
    expect(driver.sends[0]?.amount).toBe(1_500_000n);

    const patched = await adminReq(app, auth, 'PATCH', '/admin/config', {
      whitelistRewardsEnabled: false,
    });
    expect(patched.statusCode).toBe(200);

    const r2 = await claim(app, A1, '10.0.0.2');
    expect(r2.statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(1_000_000n); // entry still stored, rule off

    // Effective state is visible to the admin.
    const cfg = await adminReq(app, auth, 'GET', '/admin/config');
    expect(cfg.json().base.whitelistRewardsEnabled).toBe(false);
    expect(cfg.json().base.whitelistBonusPercent).toBe(50);
  });

  it('duplicate (kind, value) is a 409; removing the entry restores the baseline', async () => {
    const { app, driver } = await makeApp();
    const auth = await login(app);
    const first = await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1,
    });
    const { id } = first.json() as { id: string };

    const dup = await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1.toLowerCase(), // canonicalizes to the same value
    });
    expect(dup.statusCode).toBe(409);

    const removed = await adminReq(app, auth, 'DELETE', `/admin/reward-whitelist/${id}`);
    expect(removed.statusCode).toBe(200);

    const res = await claim(app, A1, '10.0.0.1');
    expect(res.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n);
  });

  it('an exact amount above the wallet balance is refused opaquely', async () => {
    const driver = new FakeNimiqDriver();
    driver.balance = 1_500_000n; // < exact 25 NIM
    const { app } = await makeApp({}, driver);
    const auth = await login(app);
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1,
      exactAmountNim: 25,
    });

    const res = await claim(app, A1, '10.0.0.1');
    expect(res.statusCode).toBe(403);
    expect(Object.keys(res.json() as Record<string, unknown>).sort()).toEqual(['id', 'status']);
    expect(driver.sends).toHaveLength(0);
  });

  it('requires an admin session for the CRUD routes', async () => {
    const { app } = await makeApp();
    const unauthed = await app.inject({
      method: 'GET',
      url: '/admin/reward-whitelist',
      headers: { accept: 'application/json' },
    });
    expect(unauthed.statusCode).toBe(401);
  });
});
