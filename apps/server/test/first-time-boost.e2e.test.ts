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
const ADMIN_PASSWORD = 'test-password-123';
const A1 = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';
const A2 = 'NQ00 2222 2222 2222 2222 2222 2222 2222 2222';
const A3 = 'NQ00 3333 3333 3333 3333 3333 3333 3333 3333';

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
): Promise<{ app: FastifyInstance; driver: FakeNimiqDriver; ctx: AppContext }> {
  const tmp = mkdtempSync(join(tmpdir(), 'faucet-ftb-'));
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
    automaticRewardsBaselineNim: '10', // 1_000_000 luna
    dev: 'true',
    rejectDelayMsMin: '0',
    // dev mode trusts loopback XFF, so tests can vary the client IP.
    ...overrides,
  });
  const { app, ctx } = await buildApp(config, { driverOverride: driver, quietLogs: true });
  await app.ready();
  open.push({ app, tmp });
  return { app, driver, ctx };
}

function claim(
  app: FastifyInstance,
  payload: Record<string, unknown>,
  ip = '203.0.113.1',
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/v1/claim',
    payload,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
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

function patchConfig(app: FastifyInstance, auth: { session: string; csrf: string }, body: Record<string, unknown>) {
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

describe('first-time boost', () => {
  it('boosts a fresh claimant and denies a repeat on the same address or IP', async () => {
    const { app, driver } = await makeApp({ firstTimeBoostPercent: '50' });

    // Fresh address + IP → boosted.
    expect((await claim(app, { address: A1 }, '203.0.113.10')).statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_500_000n);

    // Same address, different IP → not first-time (address match).
    expect((await claim(app, { address: A1 }, '203.0.113.11')).statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(1_000_000n);

    // Same IP as the first claim, brand-new address → not first-time (IP match).
    expect((await claim(app, { address: A2 }, '203.0.113.10')).statusCode).toBe(200);
    expect(driver.sends[2]?.amount).toBe(1_000_000n);
  });

  it('does not boost when the boost is unset (default)', async () => {
    const { app, driver } = await makeApp();
    expect((await claim(app, { address: A1 }, '203.0.113.20')).statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n);
  });

  it('fingerprint dimension: shared visitorId denies the boost only when enabled', async () => {
    // Enabled → a returning device (same visitorId) on a new address+IP is denied.
    const on = await makeApp({ firstTimeBoostPercent: '50', firstTimeBoostUseFingerprint: 'true' });
    await claim(on.app, { address: A1, fingerprint: { visitorId: 'VID-1' } }, '203.0.113.30');
    expect(on.driver.sends[0]?.amount).toBe(1_500_000n);
    await claim(on.app, { address: A2, fingerprint: { visitorId: 'VID-1' } }, '203.0.113.31');
    expect(on.driver.sends[1]?.amount).toBe(1_000_000n); // denied via fingerprint

    // Disabled → the same scenario still boosts (visitorId ignored).
    const off = await makeApp({ firstTimeBoostPercent: '50' });
    await claim(off.app, { address: A1, fingerprint: { visitorId: 'VID-9' } }, '203.0.113.32');
    await claim(off.app, { address: A2, fingerprint: { visitorId: 'VID-9' } }, '203.0.113.33');
    expect(off.driver.sends[1]?.amount).toBe(1_500_000n); // still boosted
  });

  it('security: an UNVERIFIED uid is ignored — it neither records nor denies the boost', async () => {
    const { app, driver, ctx } = await makeApp({
      firstTimeBoostPercent: '50',
      firstTimeBoostUseUid: 'true',
    });
    // Two claims share an unverified hostContext.uid but differ on address+IP.
    const r1 = await claim(app, { address: A1, hostContext: { uid: 'user-x' } }, '203.0.113.40');
    expect(driver.sends[0]?.amount).toBe(1_500_000n);
    const r2 = await claim(app, { address: A2, hostContext: { uid: 'user-x' } }, '203.0.113.41');
    expect(driver.sends[1]?.amount).toBe(1_500_000n); // STILL boosted — unverified uid never matched

    // And the unverified uid was never persisted into host_uid.
    const id1 = r1.json().id as string;
    const [row] = await ctx.db.select().from(claims).where(eq(claims.id, id1)).limit(1);
    expect(row?.hostUid).toBeNull();
    expect(r2.statusCode).toBe(200);
  });

  it('records the device fingerprint visitorId on the paid claim row', async () => {
    const { app, ctx } = await makeApp({ firstTimeBoostPercent: '50' });
    const res = await claim(app, { address: A1, fingerprint: { visitorId: 'VID-rec' } }, '203.0.113.50');
    const id = res.json().id as string;
    const [row] = await ctx.db.select().from(claims).where(eq(claims.id, id)).limit(1);
    expect(row?.fingerprintVisitorId).toBe('VID-rec');
  });

  it('applies a dashboard PATCH live and GET /admin/config reports the effective settings', async () => {
    const { app, driver } = await makeApp(); // boost off at boot
    expect((await claim(app, { address: A1 }, '203.0.113.60')).statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n); // no boost yet

    const auth = await login(app);
    expect(
      (await patchConfig(app, auth, { firstTimeBoostPercent: 50, firstTimeBoostUseFingerprint: true })).statusCode,
    ).toBe(200);

    const after = await claim(app, { address: A3 }, '203.0.113.61');
    expect(after.statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(1_500_000n); // boost applied live

    const cfg = await app.inject({ method: 'GET', url: '/admin/config', cookies: { faucet_session: auth.session } });
    expect(cfg.json().base.firstTimeBoostPercent).toBe(50);
    expect(cfg.json().base.firstTimeBoostUseFingerprint).toBe(true);
    expect(cfg.json().base.firstTimeBoostUseUid).toBe(false);
  });

  it('/v1/config still reports the unscaled baseline (no boost leak)', async () => {
    const { app } = await makeApp({ firstTimeBoostPercent: '50' });
    const res = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(res.json().claimAmountLuna).toBe('1000000');
    expect(res.json().claimAmountNim).toBe('10');
  });

  it('historical-null safety: an old paid row (null new columns) still denies the boost via address', async () => {
    const { app, driver, ctx } = await makeApp({ firstTimeBoostPercent: '50' });
    // Simulate a pre-feature paid claim for A1 (new identity columns are null).
    await ctx.db.insert(claims).values({
      id: 'legacy-1',
      address: A1,
      amountLuna: '1000000',
      status: 'broadcast',
      txId: 'tx_legacy',
      ip: '198.51.100.9',
      decision: 'allow',
    });
    const res = await claim(app, { address: A1 }, '203.0.113.70');
    expect(res.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n); // address backstop works retroactively
  });
});
