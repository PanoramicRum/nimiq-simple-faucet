import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const USER_ADDR = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';

class FakeDriver extends BaseTestDriver {
  override async send(to: string): Promise<string> {
    return `tx_${to.slice(-4)}`;
  }
  override async waitForConfirmation(): Promise<void> {}
}

describe('POST /v1/claim rate-limiting (@fastify/rate-limit)', () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-ratelimit-'));
    const config = ServerConfigSchema.parse({
      geoipBackend: 'none',
      network: 'test',
      dataDir: tmp,
      signerDriver: 'rpc',
      rpcUrl: 'http://unused',
      walletAddress: FAUCET_ADDR,
      claimAmountLuna: '100000',
      rateLimitPerMinute: '3',
      rateLimitPerIpPerDay: '1000',
      adminPassword: 'test-password-123',
      dev: 'true',
    });
    const built = await buildApp(config, { driverOverride: new FakeDriver(), quietLogs: true });
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns 429 once rateLimitPerMinute is exceeded on /v1/claim', async () => {
    const ip = '203.0.113.10';
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/v1/claim',
        payload: { address: USER_ADDR },
        headers: { 'content-type': 'application/json' },
        remoteAddress: ip,
      });

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await send();
      statuses.push(res.statusCode);
    }

    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
  });
});
