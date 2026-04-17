import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { DriverError } from '@faucet/core';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { claims } from '../src/db/schema.js';
import { sweep } from '../src/reconcile.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;

class MockDriver extends BaseTestDriver {
  confirmBehaviour: 'ok' | 'timeout' | 'rejected' = 'ok';
  override async getBalance() { return 0n; }
  override async send() { return 'tx_1'; }
  override async waitForConfirmation() {
    if (this.confirmBehaviour === 'ok') return;
    if (this.confirmBehaviour === 'rejected') {
      throw new DriverError('tx invalidated', 'TX_REJECTED');
    }
    throw new DriverError('timeout', 'CONFIRM_TIMEOUT');
  }
}

function baseConfig(dir: string) {
  return ServerConfigSchema.parse({
    network: 'test',
    dataDir: dir,
    signerDriver: 'rpc',
    rpcUrl: 'http://unused',
    walletAddress: FAUCET_ADDR,
    claimAmountLuna: '100000',
    adminPassword: 'test-password-123',
    dev: true,
    tlsRequired: false,
    reconcileEnabled: false, // don't auto-start; we call sweep() manually
  });
}

describe('reconciler sweep()', () => {
  let tmp: string;
  let apps: Array<Awaited<ReturnType<typeof buildApp>>['app']> = [];
  let driver: MockDriver;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-reconcile-'));
    driver = new MockDriver();
  });

  afterEach(async () => {
    for (const a of apps) await a.close();
    apps = [];
    rmSync(tmp, { recursive: true, force: true });
  });

  async function setup() {
    const built = await buildApp(baseConfig(tmp), { driverOverride: driver, quietLogs: true });
    apps.push(built.app);
    await built.app.ready();
    return built.ctx;
  }

  it('flips a broadcast claim to confirmed when the driver confirms', async () => {
    const ctx = await setup();
    driver.confirmBehaviour = 'ok';
    await ctx.db.insert(claims).values({
      id: 'test-claim-1',
      address: FAUCET_ADDR,
      amountLuna: '100000',
      status: 'broadcast',
      decision: 'allow',
      txId: '0xabc',
      ip: '127.0.0.1',
    });
    const flipped = await sweep(ctx);
    expect(flipped).toBe(1);
    const [row] = await ctx.db.select().from(claims).where(eq(claims.id, 'test-claim-1'));
    expect(row?.status).toBe('confirmed');
  });

  it('flips a broadcast claim to rejected when the tx is invalidated', async () => {
    const ctx = await setup();
    driver.confirmBehaviour = 'rejected';
    await ctx.db.insert(claims).values({
      id: 'test-claim-2',
      address: FAUCET_ADDR,
      amountLuna: '100000',
      status: 'broadcast',
      decision: 'allow',
      txId: '0xdef',
      ip: '127.0.0.1',
    });
    const flipped = await sweep(ctx);
    expect(flipped).toBe(1);
    const [row] = await ctx.db.select().from(claims).where(eq(claims.id, 'test-claim-2'));
    expect(row?.status).toBe('rejected');
  });

  it('leaves a broadcast claim as broadcast on timeout (retry next sweep)', async () => {
    const ctx = await setup();
    driver.confirmBehaviour = 'timeout';
    await ctx.db.insert(claims).values({
      id: 'test-claim-3',
      address: FAUCET_ADDR,
      amountLuna: '100000',
      status: 'broadcast',
      decision: 'allow',
      txId: '0xghi',
      ip: '127.0.0.1',
    });
    const flipped = await sweep(ctx);
    expect(flipped).toBe(0);
    const [row] = await ctx.db.select().from(claims).where(eq(claims.id, 'test-claim-3'));
    expect(row?.status).toBe('broadcast');
  });
});
