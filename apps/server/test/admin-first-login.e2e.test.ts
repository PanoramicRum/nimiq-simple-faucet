/**
 * Regression tests for #89: first-login seed branch in
 * apps/server/src/routes/admin/auth.ts.
 *
 * 1. Wrong-password behaviour is preserved after switching the `!==` compare
 *    to `timingSafeEqual`. We send a same-length but wrong password and
 *    assert 401 + no seeded admin row. (We don't attempt to measure timing;
 *    timingSafeEqual's constant-time property is Node's contract.)
 * 2. The per-route `@fastify/rate-limit` bucket throttles brute-force during
 *    the seed window. Fire `adminLoginRatePerMinute + 2` wrong attempts from
 *    one peer and assert the overflow is 429 — this pins the rate-limit
 *    contract so a future refactor can't silently drop the `config.rateLimit`
 *    block from the login route.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS } from './helpers/testDriver.js';
import { adminUsers } from '../src/db/schema.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const CORRECT_PASSWORD = 'test-password-123';

class FakeDriver extends BaseTestDriver {
  override async send(): Promise<string> { return 'tx_x'; }
}

function baseConfig(dir: string, overrides: Record<string, unknown> = {}) {
  return ServerConfigSchema.parse({
    geoipBackend: 'none',
    network: 'test',
    dataDir: dir,
    signerDriver: 'rpc',
    rpcUrl: 'http://unused',
    walletAddress: FAUCET_ADDR,
    claimAmountLuna: '100000',
    adminPassword: CORRECT_PASSWORD,
    dev: 'true',
    ...overrides,
  });
}

describe('admin first-login seed branch (#89)', () => {
  let tmp: string;
  let apps: Array<Awaited<ReturnType<typeof buildApp>>['app']> = [];
  let ctxs: Array<Awaited<ReturnType<typeof buildApp>>['ctx']> = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-admin-first-login-'));
  });

  afterEach(async () => {
    for (const a of apps) await a.close();
    apps = [];
    ctxs = [];
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns 401 and does not seed when a same-length wrong password is submitted', async () => {
    const built = await buildApp(baseConfig(tmp), {
      driverOverride: new FakeDriver(),
      quietLogs: true,
    });
    apps.push(built.app);
    ctxs.push(built.ctx);
    await built.app.ready();

    const wrong = 'x'.repeat(CORRECT_PASSWORD.length);
    expect(wrong.length).toBe(CORRECT_PASSWORD.length);

    const res = await built.app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { password: wrong },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/invalid credentials/i);

    // Confirm the seed branch did not fire — no adminUsers row.
    const rows = await built.ctx.db.select().from(adminUsers);
    expect(rows).toHaveLength(0);
  });

  it('rate-limits brute-force attempts against the seed branch (429 after the cap)', async () => {
    // Lower the per-route cap for a fast deterministic test.
    const built = await buildApp(
      baseConfig(tmp, { adminLoginRatePerMinute: '3' }),
      { driverOverride: new FakeDriver(), quietLogs: true },
    );
    apps.push(built.app);
    await built.app.ready();

    const tryWrong = () =>
      built.app.inject({
        method: 'POST',
        url: '/admin/auth/login',
        payload: { password: 'definitely-not-the-password' },
        headers: { 'content-type': 'application/json' },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await tryWrong();
      statuses.push(r.statusCode);
    }

    // The first N (≤ cap) all return 401 (credentials invalid, not throttled).
    // Once the cap is exceeded, @fastify/rate-limit returns 429.
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
