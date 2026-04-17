import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CurrencyDriver } from '@faucet/core';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';

const FAUCET_ADDR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';

class NeverReadyDriver implements CurrencyDriver {
  readonly id = 'nimiq';
  readonly networks = ['test'] as const;
  readonly readyPromise: Promise<void>;
  #ready = false;
  #release!: () => void;

  constructor() {
    this.readyPromise = new Promise<void>((resolve) => {
      this.#release = () => {
        this.#ready = true;
        resolve();
      };
    });
  }

  releaseReady(): void {
    this.#release();
  }

  async init() {}
  isReady() {
    return this.#ready;
  }
  parseAddress(s: string) {
    const n = s.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!/^NQ[0-9]{2}(?: ?[0-9A-Z]{4}){8}$/.test(n)) throw new Error(`bad: ${s}`);
    return n;
  }
  async getFaucetAddress() {
    return FAUCET_ADDR;
  }
  async getBalance() {
    return 0n;
  }
  async send() {
    return 'tx_ready' as never;
  }
  async waitForConfirmation() {}
}

function baseConfig(dir: string) {
  return ServerConfigSchema.parse({
    network: 'test',
    dataDir: dir,
    signerDriver: 'rpc',
    rpcUrl: 'http://unused',
    walletAddress: FAUCET_ADDR,
    claimAmountLuna: '100000',
    rateLimitPerIpPerDay: '100',
    adminPassword: 'test-password-123',
    corsOrigins: 'https://example.test',
    dev: true,
    tlsRequired: false,
  });
}

describe('driver readiness gating', () => {
  let tmp: string;
  let apps: Array<Awaited<ReturnType<typeof buildApp>>['app']> = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-readiness-'));
  });

  afterEach(async () => {
    for (const a of apps) await a.close();
    apps = [];
    rmSync(tmp, { recursive: true, force: true });
  });

  it('/healthz returns 200 even when driver is not ready', async () => {
    const driver = new NeverReadyDriver();
    const built = await buildApp(baseConfig(tmp), { driverOverride: driver, quietLogs: true });
    apps.push(built.app);
    await built.app.ready();
    const res = await built.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('/readyz returns 503 while driver is syncing, 200 once ready', async () => {
    const driver = new NeverReadyDriver();
    const built = await buildApp(baseConfig(tmp), { driverOverride: driver, quietLogs: true });
    apps.push(built.app);
    await built.app.ready();

    const syncing = await built.app.inject({ method: 'GET', url: '/readyz' });
    expect(syncing.statusCode).toBe(503);
    expect(syncing.headers['retry-after']).toBe('10');
    const syncBody = syncing.json();
    expect(syncBody.ready).toBe(false);
    expect(syncBody.checks.driver).toBe('not_ready');
    expect(syncBody.checks.db).toBe('ok');

    driver.releaseReady();
    const ready = await built.app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    const readyBody = ready.json();
    expect(readyBody.ready).toBe(true);
    expect(readyBody.checks.driver).toBe('ok');
    expect(readyBody.checks.db).toBe('ok');
  });

  it('POST /v1/claim returns 503 Retry-After while driver is syncing', async () => {
    const driver = new NeverReadyDriver();
    const built = await buildApp(baseConfig(tmp), { driverOverride: driver, quietLogs: true });
    apps.push(built.app);
    await built.app.ready();

    const res = await built.app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('10');
    expect(res.json()).toMatchObject({ error: 'driver_not_ready' });
  });

  it('GET /v1/config serves immediately regardless of driver state', async () => {
    const driver = new NeverReadyDriver();
    const built = await buildApp(baseConfig(tmp), { driverOverride: driver, quietLogs: true });
    apps.push(built.app);
    await built.app.ready();
    const res = await built.app.inject({ method: 'GET', url: '/v1/config' });
    expect(res.statusCode).toBe(200);
  });
});
