import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const USER_ADDR = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';

class FakeNimiqDriver extends BaseTestDriver {
  public sends: Array<{ to: string; amount: bigint }> = [];
  public balance = 10_000_000n;

  override async getBalance() {
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

// Per-test app factory: each test gets a fresh DB, driver, and config so the
// IP counter / claim history never bleeds across cases.
const open: Array<{ app: FastifyInstance; tmp: string }> = [];

async function makeApp(
  overrides: Record<string, unknown> = {},
  driver: FakeNimiqDriver = new FakeNimiqDriver(),
): Promise<{ app: FastifyInstance; driver: FakeNimiqDriver }> {
  const tmp = mkdtempSync(join(tmpdir(), 'faucet-autoreward-'));
  const config = ServerConfigSchema.parse({
    geoipBackend: 'none',
    network: 'test',
    dataDir: tmp,
    signerDriver: 'rpc',
    rpcUrl: 'http://unused',
    walletAddress: FAUCET_ADDR,
    claimAmountLuna: '100000',
    rateLimitPerIpPerDay: '100',
    adminPassword: 'test-password-123',
    dev: 'true',
    rejectDelayMsMin: '0',
    ...overrides,
  });
  const { app } = await buildApp(config, { driverOverride: driver, quietLogs: true });
  await app.ready();
  open.push({ app, tmp });
  return { app, driver };
}

function claim(app: FastifyInstance, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/v1/claim',
    payload,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(async () => {
  for (const { app, tmp } of open.splice(0)) {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

describe('automatic reward mode', () => {
  // Test #1: explicit/default flow unchanged when automatic mode is disabled.
  // Disabled = omit the flag (z.coerce.boolean treats any non-empty string,
  // including 'false', as true — the repo-wide convention is "absent = off").
  it('automatic OFF → pays the fixed claimAmountLuna', async () => {
    const { app, driver } = await makeApp();
    const res = await claim(app, { address: USER_ADDR });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('broadcast');
    expect(driver.sends).toHaveLength(1);
    expect(driver.sends[0]?.amount).toBe(100_000n);
  });

  // Test #2: automatic mode pays the configured baseline (10 NIM = 1_000_000 luna).
  it('automatic ON → pays the baseline amount', async () => {
    const { app, driver } = await makeApp({
      automaticRewardsEnabled: 'true',
      automaticRewardsBaselineNim: '10',
    });
    const res = await claim(app, { address: USER_ADDR });
    expect(res.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n);
  });

  // Test #3: automatic mode needs no amount in the request.
  it('automatic ON → succeeds with only an address in the body', async () => {
    const { app, driver } = await makeApp({
      automaticRewardsEnabled: 'true',
      automaticRewardsBaselineNim: '10',
    });
    const res = await claim(app, { address: USER_ADDR }); // no amount field at all
    expect(res.statusCode).toBe(200);
    expect(driver.sends).toHaveLength(1);
    expect(driver.sends[0]?.amount).toBe(1_000_000n);
  });

  // Test #4: any developer-sent amount is ignored; the baseline is used.
  it('automatic ON → ignores a request amount and uses the baseline', async () => {
    const { app, driver } = await makeApp({
      automaticRewardsEnabled: 'true',
      automaticRewardsBaselineNim: '10',
    });
    const res = await claim(app, { address: USER_ADDR, amount: 999, amountLuna: '999' });
    expect(res.statusCode).toBe(200);
    expect(driver.sends).toHaveLength(1);
    expect(driver.sends[0]?.amount).toBe(1_000_000n); // baseline, not 999
  });

  // Test #5: an invalid baseline is refused opaquely with no payout.
  for (const [label, baseline] of [
    ['missing', undefined],
    ['zero', '0'],
    ['negative', '-5'],
  ] as const) {
    it(`automatic ON → opaque reject (no send) when baseline is ${label}`, async () => {
      const overrides: Record<string, unknown> = { automaticRewardsEnabled: 'true' };
      if (baseline !== undefined) overrides.automaticRewardsBaselineNim = baseline;
      const { app, driver } = await makeApp(overrides);
      const res = await claim(app, { address: USER_ADDR });
      expect(res.statusCode).toBe(403);
      // Same opaque shape as an abuse denial — no error attribution.
      expect(res.json()).toMatchObject({ status: 'rejected' });
      expect(res.json().error).toBeUndefined();
      expect(driver.sends).toHaveLength(0);
    });
  }

  // Test #6: automatic mode still runs the existing claim validation/pipeline.
  it('automatic ON → still rejects an invalid address with 400 (existing validation applies)', async () => {
    const { app, driver } = await makeApp({
      automaticRewardsEnabled: 'true',
      automaticRewardsBaselineNim: '10',
    });
    const res = await claim(app, { address: 'not-an-address' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/invalid address/i);
    expect(driver.sends).toHaveLength(0);
  });

  // Test #7: the automatic amount cannot exceed the available balance.
  it('automatic ON → opaque reject (no send) when the baseline exceeds wallet balance', async () => {
    const driver = new FakeNimiqDriver();
    driver.balance = 500_000n; // baseline 10 NIM = 1_000_000 luna > balance
    const { app } = await makeApp(
      { automaticRewardsEnabled: 'true', automaticRewardsBaselineNim: '10' },
      driver,
    );
    const res = await claim(app, { address: USER_ADDR });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ status: 'rejected' });
    expect(driver.sends).toHaveLength(0);
  });

  // /v1/config reflects the effective automatic-mode amount so the UI shows the
  // right number ("you'll receive X NIM").
  it('automatic ON → /v1/config reports the baseline as the effective amount', async () => {
    const { app } = await makeApp({
      automaticRewardsEnabled: 'true',
      automaticRewardsBaselineNim: '10',
    });
    const res = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json().claimAmountLuna).toBe('1000000');
    expect(res.json().claimAmountNim).toBe('10');
  });
});
