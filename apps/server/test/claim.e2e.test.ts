import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CurrencyDriver } from '@faucet/core';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';

const FAUCET_ADDR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';
const USER_ADDR = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';

class FakeNimiqDriver implements CurrencyDriver {
  readonly id = 'nimiq';
  readonly networks = ['test'] as const;
  public sends: Array<{ to: string; amount: bigint }> = [];
  public balance = 10_000_000n;

  async init(): Promise<void> {}
  parseAddress(s: string): string {
    const n = s.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!/^NQ[0-9]{2}(?: ?[0-9A-Z]{4}){8}$/.test(n)) {
      throw new Error(`bad address: ${s}`);
    }
    return n;
  }
  async getFaucetAddress() {
    return FAUCET_ADDR;
  }
  async getBalance() {
    return this.balance;
  }
  async send(to: string, amount: bigint): Promise<string> {
    this.sends.push({ to, amount });
    this.balance -= amount;
    return `tx_${this.sends.length}`;
  }
  async waitForConfirmation(): Promise<void> {
    // confirmed instantly
  }
}

describe('POST /v1/claim', () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let driver: FakeNimiqDriver;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-e2e-'));
    const config = ServerConfigSchema.parse({
      network: 'test',
      dataDir: tmp,
      signerDriver: 'rpc',
      rpcUrl: 'http://unused',
      walletAddress: FAUCET_ADDR,
      claimAmountLuna: '100000',
      rateLimitPerIpPerDay: '3',
      adminPassword: 'test-password-123',
      dev: 'true',
    });
    driver = new FakeNimiqDriver();
    const built = await buildApp(config, { driverOverride: driver, quietLogs: true });
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns broadcast status and calls the driver on a clean claim', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('broadcast');
    expect(body.txId).toMatch(/^tx_/);
    expect(driver.sends).toHaveLength(1);
    expect(driver.sends[0]?.amount).toBe(100_000n);
    expect(driver.sends[0]?.to).toBe(USER_ADDR);
  });

  it('rejects an invalid address with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: 'not-an-address' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/invalid address/i);
  });

  it('denies once the per-IP daily cap is exceeded', async () => {
    // cap is 3; one claim was used above. Fire 2 more to reach cap, then a 4th denied.
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/claim',
        payload: { address: USER_ADDR },
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(200);
    }
    const capped = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR },
      headers: { 'content-type': 'application/json' },
    });
    expect(capped.statusCode).toBe(403);
    const body = capped.json();
    expect(body.decision).toBe('deny');
    expect(body.reason).toMatch(/daily cap/);
  });

  it('looks up a claim by id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR.replace('1111', '2222') },
      headers: { 'content-type': 'application/json' },
    });
    // IP cap may block further successes; either way the claim row exists.
    const id = created.json().id as string;
    expect(id).toBeTruthy();
    const status = await app.inject({ method: 'GET', url: `/v1/claim/${id}` });
    expect(status.statusCode).toBe(200);
    expect(status.json().id).toBe(id);
  });

  it('serves /v1/config and /llms.txt', async () => {
    const cfg = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json().network).toBe('test');
    expect(cfg.json().claimAmountLuna).toBe('100000');

    const llms = await app.inject({ method: 'GET', url: '/llms.txt' });
    expect(llms.statusCode).toBe(200);
    expect(llms.body).toContain('Nimiq Simple Faucet');
  });
});
