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
const A3 = 'NQ00 3333 3333 3333 3333 3333 3333 3333 3333';

class FakeNimiqDriver extends BaseTestDriver {
  public sends: Array<{ to: string; amount: bigint }> = [];
  public balance = 100_000_000n;
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
  override async waitForConfirmation(): Promise<void> {}
}

const open: Array<{ app: FastifyInstance; tmp: string }> = [];

async function makeApp(
  overrides: Record<string, unknown> = {},
  driver: FakeNimiqDriver = new FakeNimiqDriver(),
): Promise<{ app: FastifyInstance; driver: FakeNimiqDriver }> {
  const tmp = mkdtempSync(join(tmpdir(), 'faucet-repeat-e2e-'));
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
    // dev mode trusts loopback XFF, so tests can vary the client IP.
    ...overrides,
  });
  const { app } = await buildApp(config, { driverOverride: driver, quietLogs: true });
  await app.ready();
  open.push({ app, tmp });
  return { app, driver };
}

function claim(app: FastifyInstance, address: string, ip: string, visitorId?: string) {
  const payload: Record<string, unknown> = { address };
  if (visitorId) payload.fingerprint = { visitorId };
  return app.inject({
    method: 'POST',
    url: '/v1/claim',
    payload,
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

describe('repeat-user reduction', () => {
  it('reduces once the address claim-count meets the daily tier; other identities unaffected', async () => {
    // Daily tier: ≥ 2 paid claims in 24h → reduce 30%. Address signal on by default.
    const { app, driver } = await makeApp({
      repeatReductionDailyThreshold: '2',
      repeatReductionDailyPercent: '30',
    });

    // Same address, varying IP → the address dimension accumulates the count.
    expect((await claim(app, A1, '198.51.100.1')).statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n); // 0 prior → full
    expect((await claim(app, A1, '198.51.100.2')).statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(1_000_000n); // 1 prior (< 2) → full
    expect((await claim(app, A1, '198.51.100.3')).statusCode).toBe(200);
    expect(driver.sends[2]?.amount).toBe(700_000n); // 2 prior (≥ 2) → −30%

    // A different address is unaffected (its own count is 0).
    expect((await claim(app, A2, '198.51.100.9')).statusCode).toBe(200);
    expect(driver.sends[3]?.amount).toBe(1_000_000n);
  });

  it('identity multi-select: IP-only counts across addresses; address-only does not', async () => {
    // IP-only: same IP, different addresses accumulate.
    const ipOnly = await makeApp({
      repeatReductionDailyThreshold: '2',
      repeatReductionDailyPercent: '30',
      repeatReductionUseAddress: false,
      repeatReductionUseIp: true,
    });
    expect((await claim(ipOnly.app, A1, '198.51.100.20')).statusCode).toBe(200);
    expect(ipOnly.driver.sends[0]?.amount).toBe(1_000_000n);
    await claim(ipOnly.app, A2, '198.51.100.20');
    expect(ipOnly.driver.sends[1]?.amount).toBe(1_000_000n); // 1 prior (< 2)
    await claim(ipOnly.app, A3, '198.51.100.20');
    expect(ipOnly.driver.sends[2]?.amount).toBe(700_000n); // 2 prior on the IP → −30%

    // Address-only: same IP, different addresses do NOT accumulate.
    const addrOnly = await makeApp({
      repeatReductionDailyThreshold: '2',
      repeatReductionDailyPercent: '30',
      repeatReductionUseAddress: true,
      repeatReductionUseIp: false,
    });
    await claim(addrOnly.app, A1, '198.51.100.30');
    await claim(addrOnly.app, A2, '198.51.100.30');
    await claim(addrOnly.app, A3, '198.51.100.30');
    expect(addrOnly.driver.sends.map((s) => s.amount)).toEqual([
      1_000_000n,
      1_000_000n,
      1_000_000n,
    ]);
  });

  it('largest tier wins when several tiers trigger', async () => {
    // Daily 2 → 30%, Weekly 2 → 50%. On the 3rd claim both windows hold 2 → max = 50%.
    const { app, driver } = await makeApp({
      repeatReductionDailyThreshold: '2',
      repeatReductionDailyPercent: '30',
      repeatReductionWeeklyThreshold: '2',
      repeatReductionWeeklyPercent: '50',
    });
    await claim(app, A1, '198.51.100.40');
    await claim(app, A1, '198.51.100.41');
    await claim(app, A1, '198.51.100.42');
    expect(driver.sends[2]?.amount).toBe(500_000n); // −50%, not −30%
  });

  it('applies a dashboard PATCH live; GET reports effective values; /v1/config stays unscaled', async () => {
    const { app, driver } = await makeApp(); // no repeat config at boot
    await claim(app, A1, '198.51.100.50');
    await claim(app, A1, '198.51.100.51');
    expect(driver.sends.map((s) => s.amount)).toEqual([1_000_000n, 1_000_000n]); // no reduction yet

    const auth = await login(app);
    expect(
      (
        await patchConfig(app, auth, {
          repeatReductionDailyThreshold: 1,
          repeatReductionDailyPercent: 40,
          repeatReductionUseIp: true,
        })
      ).statusCode,
    ).toBe(200);

    // 2 prior paid claims on A1 ≥ threshold 1 → reduced 40% live.
    expect((await claim(app, A1, '198.51.100.52')).statusCode).toBe(200);
    expect(driver.sends[2]?.amount).toBe(600_000n);

    const cfg = await app.inject({
      method: 'GET',
      url: '/admin/config',
      cookies: { faucet_session: auth.session },
    });
    expect(cfg.json().base.repeatReductionDailyThreshold).toBe(1);
    expect(cfg.json().base.repeatReductionDailyPercent).toBe(40);
    expect(cfg.json().base.repeatReductionUseAddress).toBe(true); // env default
    expect(cfg.json().base.repeatReductionUseIp).toBe(true); // override

    // Public config never leaks a per-identity scaled amount.
    const pub = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(pub.json().claimAmountLuna).toBe('1000000');
  });

  it('boost ⊥ repeat: a returning claimant gets the reduction, not the first-time boost', async () => {
    const { app, driver } = await makeApp({
      firstTimeBoostPercent: '50',
      repeatReductionDailyThreshold: '1',
      repeatReductionDailyPercent: '30',
    });
    // First claim: first-time (no prior paid) and repeat count 0 (< 1) → boosted.
    expect((await claim(app, A1, '198.51.100.60')).statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_500_000n);
    // Second claim on the same address: 1 prior paid ≥ 1 → reduction fires, boost suppressed.
    expect((await claim(app, A1, '198.51.100.61')).statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(700_000n);
  });

  it('fingerprint dimension: same visitorId across distinct address+IP accumulates only when enabled', async () => {
    // Fingerprint-only: same visitorId, distinct address+IP → the visitorId accumulates.
    const on = await makeApp({
      repeatReductionDailyThreshold: '2',
      repeatReductionDailyPercent: '30',
      repeatReductionUseAddress: false,
      repeatReductionUseFingerprint: true,
    });
    await claim(on.app, A1, '198.51.100.90', 'VFP-1');
    expect(on.driver.sends[0]?.amount).toBe(1_000_000n); // 0 prior on the visitorId
    await claim(on.app, A2, '198.51.100.91', 'VFP-1');
    expect(on.driver.sends[1]?.amount).toBe(1_000_000n); // 1 prior (< 2)
    await claim(on.app, A3, '198.51.100.92', 'VFP-1');
    expect(on.driver.sends[2]?.amount).toBe(700_000n); // 2 prior on the visitorId → −30%

    // Fingerprint OFF (default): the same visitorId across distinct address+IP does NOT accumulate.
    const off = await makeApp({
      repeatReductionDailyThreshold: '2',
      repeatReductionDailyPercent: '30',
    });
    await claim(off.app, A1, '198.51.100.93', 'VFP-2');
    await claim(off.app, A2, '198.51.100.94', 'VFP-2');
    await claim(off.app, A3, '198.51.100.95', 'VFP-2');
    expect(off.driver.sends.map((s) => s.amount)).toEqual([1_000_000n, 1_000_000n, 1_000_000n]);
  });

  it('a combined ≥100% reduction scales to zero and returns the uniform opaque 403', async () => {
    const { app, driver } = await makeApp({
      repeatReductionDailyThreshold: '1',
      repeatReductionDailyPercent: '100',
    });
    // First claim pays full (count 0 < 1).
    expect((await claim(app, A1, '198.51.100.100')).statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n);
    // Second claim: 1 prior ≥ 1 → 100% reduction → amount 0n → opaque refusal, no send.
    const res = await claim(app, A1, '198.51.100.101');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ id: expect.any(String), status: 'rejected' });
    // Exactly two keys — guards against a future tier/percent/reason leak in the body.
    expect(Object.keys(res.json()).sort()).toEqual(['id', 'status']);
    expect(driver.sends).toHaveLength(1); // nothing sent on the refusal
  });

  it('over-balance guard compares the post-reduction amount, not the baseline', async () => {
    const { app, driver } = await makeApp({
      repeatReductionDailyThreshold: '1',
      repeatReductionDailyPercent: '30',
    });
    // Build one paid claim on A1 while the wallet is flush.
    expect((await claim(app, A1, '198.51.100.110')).statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n);
    // Wallet now sits between the reduced amount (700k) and the baseline (1M).
    driver.balance = 800_000n;
    // Returning claimant: the reduction pulls the payout under balance → PAID 700k.
    expect((await claim(app, A1, '198.51.100.111')).statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(700_000n);
    // A fresh (non-reduced) claimant at the same balance: baseline 1M > 800k → uniform 403.
    driver.balance = 800_000n;
    const res = await claim(app, A2, '198.51.100.112');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ id: expect.any(String), status: 'rejected' });
    expect(driver.sends).toHaveLength(2); // no new send
  });

  it('applies the repeat reduction even when the balance read fails (over-balance guard skipped)', async () => {
    const { app, driver } = await makeApp({
      repeatReductionDailyThreshold: '2',
      repeatReductionDailyPercent: '30',
    });
    expect((await claim(app, A1, '198.51.100.120')).statusCode).toBe(200);
    expect((await claim(app, A1, '198.51.100.121')).statusCode).toBe(200);
    expect(driver.sends.map((s) => s.amount)).toEqual([1_000_000n, 1_000_000n]);
    // getBalance() now throws → balance unknown. Low-balance scaling would skip and the
    // first-time boost would suppress, but the repeat reduction must still apply.
    driver.failBalance = true;
    expect((await claim(app, A1, '198.51.100.122')).statusCode).toBe(200);
    expect(driver.sends[2]?.amount).toBe(700_000n);
  });
});
