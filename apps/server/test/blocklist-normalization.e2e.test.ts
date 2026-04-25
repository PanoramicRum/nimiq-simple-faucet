/**
 * Regression tests for #94: blocklist normalization. Two end-to-end paths:
 *
 * 1. An admin (or seed migration) stored a value in the canonical form
 *    (`1.2.3.4`). A request arrives over an IPv6 socket and surfaces as
 *    `::ffff:1.2.3.4` in `req.ip`. Before normalization the lookup
 *    missed; now the normalization on the read path canonicalises both
 *    sides to `1.2.3.4` and the block fires (deny).
 *
 * 2. The boot-time migration. A pre-existing row with the
 *    non-canonical `::ffff:1.2.3.4` form gets rewritten to `1.2.3.4`.
 *    `migrateBlocklistNormalization` runs at app boot, so the second
 *    `buildApp()` call here exercises that path.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { blocklist } from '../src/db/schema.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const USER_ADDR = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';

class FakeDriver extends BaseTestDriver {
  override async send(): Promise<string> { return 'tx_x'; }
  override async waitForConfirmation(): Promise<void> {}
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
    rateLimitPerIpPerDay: '100',
    adminPassword: 'test-password-123',
    dev: 'true',
    // Trust loopback (added automatically in dev) so XFF in tests is
    // honoured — the e2e mocks the socket as 127.0.0.1.
    ...overrides,
  });
}

describe('blocklist normalization (#94)', () => {
  let tmp: string;
  let apps: Array<Awaited<ReturnType<typeof buildApp>>['app']> = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-blocklist-norm-'));
  });

  afterEach(async () => {
    for (const a of apps) await a.close();
    apps = [];
    rmSync(tmp, { recursive: true, force: true });
  });

  it('matches an IPv6-mapped IPv4 caller against an IPv4-stored block', async () => {
    const built = await buildApp(baseConfig(tmp), {
      driverOverride: new FakeDriver(),
      quietLogs: true,
    });
    apps.push(built.app);
    await built.app.ready();

    // Seed a canonical IPv4 block directly in the DB.
    await built.ctx.db.insert(blocklist).values({
      id: nanoid(),
      kind: 'ip',
      value: '203.0.113.42',
      reason: 'test',
      createdAt: new Date(),
      expiresAt: null,
    });

    // Caller arrives via IPv6-mapped IPv4. With dev=true, loopback is in
    // the trustProxy CIDR allow-list so XFF is honoured.
    const res = await built.app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR },
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '::ffff:203.0.113.42',
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.decision).toBe('deny');
    expect(body.reason).toMatch(/blocklisted ip/i);
  });

  it('re-normalises pre-existing rows on boot (idempotent migration)', async () => {
    // Boot once just to create the schema, then seed a non-canonical row
    // that simulates a value inserted by an older build. Closing the first
    // app and booting again triggers the migration.
    const first = await buildApp(baseConfig(tmp), {
      driverOverride: new FakeDriver(),
      quietLogs: true,
    });
    apps.push(first.app);
    await first.app.ready();
    const id = nanoid();
    await first.ctx.db.insert(blocklist).values({
      id,
      kind: 'ip',
      value: '::ffff:198.51.100.1', // non-canonical IPv6-mapped form
      reason: 'pre-existing',
      createdAt: new Date(),
      expiresAt: null,
    });

    // Bring up a second instance against the same data dir → migration runs.
    const second = await buildApp(baseConfig(tmp), {
      driverOverride: new FakeDriver(),
      quietLogs: true,
    });
    apps.push(second.app);
    await second.app.ready();

    const [row] = await second.ctx.db
      .select()
      .from(blocklist)
      .where(eq(blocklist.id, id))
      .limit(1);
    expect(row?.value).toBe('198.51.100.1');
  });
});
