import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CurrencyDriver } from '@faucet/core';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';

const FAUCET_ADDR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';

class StubDriver implements CurrencyDriver {
  readonly id = 'nimiq';
  readonly networks = ['test'] as const;
  async init() {}
  parseAddress(s: string) {
    return s.trim().toUpperCase().replace(/\s+/g, ' ');
  }
  async getFaucetAddress() { return FAUCET_ADDR; }
  async getBalance() { return 42_000n; }
  async send() { return 'tx_1'; }
  async waitForConfirmation() {}
}

function baseConfig(dir: string, overrides: Record<string, unknown> = {}) {
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
    metricsEnabled: true,
    ...overrides,
  });
}

describe('/metrics endpoint', () => {
  let tmp: string;
  let apps: Array<Awaited<ReturnType<typeof buildApp>>['app']> = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-metrics-'));
  });

  afterEach(async () => {
    for (const a of apps) await a.close();
    apps = [];
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns Prometheus text format with expected metrics', async () => {
    const built = await buildApp(baseConfig(tmp), { driverOverride: new StubDriver(), quietLogs: true });
    apps.push(built.app);
    await built.app.ready();
    const res = await built.app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    const body = res.payload;
    expect(body).toContain('faucet_claims_total');
    expect(body).toContain('faucet_wallet_balance_luna');
    expect(body).toContain('faucet_driver_ready');
    expect(body).toContain('faucet_claim_duration_seconds');
  });

  it('returns 404 when metricsEnabled is false', async () => {
    const built = await buildApp(baseConfig(tmp, { metricsEnabled: false }), {
      driverOverride: new StubDriver(),
      quietLogs: true,
    });
    apps.push(built.app);
    await built.app.ready();
    const res = await built.app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(404);
  });
});
