import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CurrencyDriver } from '@faucet/core';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';

const FAUCET_ADDR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';
const USER_ADDR = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';

class StubDriver implements CurrencyDriver {
  readonly id = 'nimiq';
  readonly networks = ['test'] as const;
  public sends: Array<{ to: string; amount: bigint }> = [];
  async init() {}
  parseAddress(s: string) {
    return s.trim().toUpperCase().replace(/\s+/g, ' ');
  }
  async getFaucetAddress() {
    return FAUCET_ADDR;
  }
  async getBalance() {
    return 0n;
  }
  async send(to: string, amount: bigint) {
    this.sends.push({ to, amount });
    return `tx_${this.sends.length}`;
  }
  async waitForConfirmation() {}
}

describe('fingerprint abuse layer', () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-fp-'));
    const config = ServerConfigSchema.parse({
      network: 'test',
      dataDir: tmp,
      signerDriver: 'rpc',
      rpcUrl: 'http://unused',
      walletAddress: FAUCET_ADDR,
      claimAmountLuna: '100000',
      rateLimitPerIpPerDay: '100',
      adminPassword: 'test-password-123',
      fingerprintEnabled: 'true',
      // Tight threshold so a second distinct uid for the same visitor trips deny.
      fingerprintMaxUidsPerVisitor: '1',
      fingerprintMaxVisitorsPerUid: '10',
      dev: 'true',
    });
    const built = await buildApp(config, { driverOverride: new StubDriver(), quietLogs: true });
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('advertises fingerprint in /v1/config', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(res.json().abuseLayers.fingerprint).toBe(true);
  });

  it('denies a second claim from the same visitor under a different uid', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: {
        address: USER_ADDR,
        fingerprint: { visitorId: 'visitor-A' },
        hostContext: { uid: 'uid-1' },
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe('broadcast');

    const second = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: {
        address: USER_ADDR.replace('1111', '2222'),
        fingerprint: { visitorId: 'visitor-A' },
        hostContext: { uid: 'uid-2' },
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(second.statusCode).toBe(403);
    expect(second.json().decision).toBe('deny');
    expect(second.json().reason).toMatch(/uids/);
  });
});
