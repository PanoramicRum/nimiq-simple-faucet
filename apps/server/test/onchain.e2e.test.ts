import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HistorySummary } from '@faucet/core';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const SWEEPER_ADDR = 'NQ00 5555 5555 5555 5555 5555 5555 5555 5555';
const FRESH_ADDR = 'NQ00 6666 6666 6666 6666 6666 6666 6666 6666';

class StubDriver extends BaseTestDriver {
  public sends: Array<{ to: string; amount: bigint }> = [];
  public historyFor = new Map<string, HistorySummary>();
  override async getBalance() {
    return 0n;
  }
  override async send(to: string, amount: bigint) {
    this.sends.push({ to, amount });
    return `tx_${this.sends.length}`;
  }
  override async addressHistory(address: string): Promise<HistorySummary> {
    const hit = this.historyFor.get(address);
    if (hit) return hit;
    return {
      firstSeenAt: null,
      incomingCount: 0,
      outgoingCount: 0,
      totalReceived: 0n,
      totalSent: 0n,
      isSweeper: false,
    };
  }
}

describe('onchain-nimiq abuse layer', () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let driver: StubDriver;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-oc-'));
    const config = ServerConfigSchema.parse({
      network: 'test',
      dataDir: tmp,
      signerDriver: 'rpc',
      rpcUrl: 'http://unused',
      walletAddress: FAUCET_ADDR,
      claimAmountLuna: '100000',
      rateLimitPerIpPerDay: '100',
      adminPassword: 'test-password-123',
      onchainEnabled: 'true',
      onchainDenyIfSweeper: 'true',
      dev: 'true',
    });
    driver = new StubDriver();
    driver.historyFor.set(SWEEPER_ADDR, {
      firstSeenAt: 1_700_000_000_000,
      incomingCount: 5,
      outgoingCount: 3,
      totalReceived: 10_000n,
      totalSent: 9_800n,
      isSweeper: true,
    });
    const built = await buildApp(config, { driverOverride: driver, quietLogs: true });
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('advertises onchain in /v1/config', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(res.json().abuseLayers.onchain).toBe(true);
  });

  it('denies a claim to a sweeper address', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: SWEEPER_ADDR },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().decision).toBe('deny');
    expect(res.json().reason).toMatch(/sweeper/i);
    expect(driver.sends).toHaveLength(0);
  });

  it('allows a claim to a fresh (unseen) address', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: FRESH_ADDR },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('broadcast');
  });
});
