import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { claims } from '../src/db/schema.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS, parseCookie } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const USER_ADDR = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';
const ADMIN_PASSWORD = 'test-password-123';

class FakeNimiqDriver extends BaseTestDriver {
  public sends: Array<{ to: string; amount: bigint }> = [];
  public balance = 10_000_000n;
  public failBalance = false;

  override async getBalance() {
    if (this.failBalance) throw new Error('rpc down');
    return this.balance;
  }
  override async send(to: string, amount: bigint): Promise<string> {
    this.sends.push({ to, amount });
    this.balance -= amount;
    return `tx_${this.sends.length}`;
  }
  override async waitForConfirmation(): Promise<void> {
    // confirmed instantly
  }
}

const open: Array<{ app: FastifyInstance; tmp: string }> = [];

async function makeApp(
  overrides: Record<string, unknown> = {},
  driver: FakeNimiqDriver = new FakeNimiqDriver(),
): Promise<{ app: FastifyInstance; driver: FakeNimiqDriver; ctx: AppContext }> {
  const tmp = mkdtempSync(join(tmpdir(), 'faucet-lowbal-'));
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
    dev: 'true',
    rejectDelayMsMin: '0',
    ...overrides,
  });
  const { app, ctx } = await buildApp(config, { driverOverride: driver, quietLogs: true });
  await app.ready();
  open.push({ app, tmp });
  return { app, driver, ctx };
}

function claim(app: FastifyInstance, payload: Record<string, unknown> = { address: USER_ADDR }) {
  return app.inject({
    method: 'POST',
    url: '/v1/claim',
    payload,
    headers: { 'content-type': 'application/json' },
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

function patchConfig(
  app: FastifyInstance,
  auth: { session: string; csrf: string },
  body: Record<string, unknown>,
) {
  return app.inject({
    method: 'PATCH',
    url: '/admin/config',
    payload: body,
    headers: { 'content-type': 'application/json', 'x-faucet-csrf': auth.csrf },
    cookies: { faucet_session: auth.session, faucet_csrf: auth.csrf },
  });
}

afterEach(async () => {
  for (const { app, tmp } of open.splice(0)) {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

describe('low-balance reward scaling', () => {
  // baseline 10 NIM = 1_000_000 luna; threshold 20 NIM = 2_000_000 luna.

  it('scales the reward from env-configured threshold + reduction when balance is below it', async () => {
    const driver = new FakeNimiqDriver();
    driver.balance = 1_000_000n; // < 2_000_000 (scales) and >= 750_000 (payable)
    const { app } = await makeApp(
      { lowBalanceThresholdNim: '20', lowBalanceReductionPercent: '25' },
      driver,
    );
    const res = await claim(app);
    expect(res.statusCode).toBe(200);
    expect(driver.sends).toHaveLength(1);
    expect(driver.sends[0]?.amount).toBe(750_000n); // 25% off 1_000_000
  });

  it('applies a dashboard PATCH live — no restart needed', async () => {
    const driver = new FakeNimiqDriver();
    // Enough for a full first claim (1_000_000) and still below the 20-NIM
    // threshold afterwards (1_500_000) so the post-PATCH claim scales and pays.
    driver.balance = 2_500_000n;
    const { app } = await makeApp({}, driver); // no env low-balance settings

    // Before any PATCH → full baseline.
    const before = await claim(app);
    expect(before.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n);

    // Admin sets the low-balance settings via the dashboard API.
    const auth = await login(app);
    const patched = await patchConfig(app, auth, {
      lowBalanceThresholdNim: 20,
      lowBalanceReductionPercent: 25,
    });
    expect(patched.statusCode).toBe(200);

    // Next claim reflects the override immediately.
    const after = await claim(app, { address: 'NQ00 2222 2222 2222 2222 2222 2222 2222 2222' });
    expect(after.statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(750_000n);
  });

  it('pays the full baseline when balance is at or above the threshold', async () => {
    const driver = new FakeNimiqDriver();
    driver.balance = 2_500_000n; // >= 2_000_000 threshold
    const { app } = await makeApp(
      { lowBalanceThresholdNim: '20', lowBalanceReductionPercent: '25' },
      driver,
    );
    const res = await claim(app);
    expect(res.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n);
  });

  it('100% reduction pauses payouts: opaque reject, no send, reason scaled_to_zero', async () => {
    const driver = new FakeNimiqDriver();
    driver.balance = 1_000_000n; // below threshold
    const { app, ctx } = await makeApp(
      { lowBalanceThresholdNim: '20', lowBalanceReductionPercent: '100' },
      driver,
    );
    const res = await claim(app);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ status: 'rejected' });
    expect(driver.sends).toHaveLength(0);

    const id = res.json().id as string;
    const [row] = await ctx.db.select().from(claims).where(eq(claims.id, id)).limit(1);
    expect(row?.rejectionReason).toBe('automatic_reward_scaled_to_zero');
  });

  it('records the SCALED amount on the broadcast claim row (regression: line-458 bug)', async () => {
    const driver = new FakeNimiqDriver();
    driver.balance = 1_000_000n;
    const { app } = await makeApp(
      { lowBalanceThresholdNim: '20', lowBalanceReductionPercent: '25' },
      driver,
    );
    const res = await claim(app);
    const id = res.json().id as string;
    const status = await app.inject({ method: 'GET', url: `/v1/claim/${id}` });
    expect(status.json().amountLuna).toBe('750000'); // scaled, not the 100000 config claimAmountLuna
  });

  it('GET /admin/config reports the effective (overridden) low-balance settings', async () => {
    const { app } = await makeApp();
    const auth = await login(app);
    await patchConfig(app, auth, { lowBalanceThresholdNim: 20, lowBalanceReductionPercent: 25 });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/config',
      cookies: { faucet_session: auth.session },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().base.lowBalanceThresholdNim).toBe(20);
    expect(res.json().base.lowBalanceReductionPercent).toBe(25);
  });

  it('/v1/config still reports the UNSCALED baseline (no wallet-state leak)', async () => {
    const driver = new FakeNimiqDriver();
    driver.balance = 1_000_000n; // below threshold — scaling would apply to a claim
    const { app } = await makeApp(
      { lowBalanceThresholdNim: '20', lowBalanceReductionPercent: '25' },
      driver,
    );
    const res = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(res.json().claimAmountLuna).toBe('1000000');
    expect(res.json().claimAmountNim).toBe('10');
  });

  it('does NOT scale when getBalance() fails — pays the full baseline', async () => {
    const driver = new FakeNimiqDriver();
    driver.failBalance = true;
    const { app } = await makeApp(
      { lowBalanceThresholdNim: '20', lowBalanceReductionPercent: '25' },
      driver,
    );
    const res = await claim(app);
    expect(res.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n);
  });

  it('PATCH /admin/config requires an admin session', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/config',
      payload: { lowBalanceThresholdNim: 20 },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(401);
    expect(res.statusCode).toBeLessThan(404);
  });
});
