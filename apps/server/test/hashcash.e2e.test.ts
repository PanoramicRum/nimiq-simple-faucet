import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { solveChallenge } from '@faucet/abuse-hashcash';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const USER_ADDR = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';

class StubDriver extends BaseTestDriver {
  public sends: Array<{ to: string; amount: bigint }> = [];
  override async getBalance() {
    return 0n;
  }
  override async send(to: string, amount: bigint) {
    this.sends.push({ to, amount });
    return `tx_${this.sends.length}`;
  }
}

describe('hashcash challenge flow', () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let driver: StubDriver;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-hc-'));
    const config = ServerConfigSchema.parse({ geoipBackend: "none",
      network: 'test',
      dataDir: tmp,
      signerDriver: 'rpc',
      rpcUrl: 'http://unused',
      walletAddress: FAUCET_ADDR,
      claimAmountLuna: '100000',
      rateLimitPerIpPerDay: '5',
      adminPassword: 'test-password-123',
      hashcashSecret: 'unit-test-secret-16bytes-minimum',
      hashcashDifficulty: '8',
      dev: 'true',
    });
    driver = new StubDriver();
    const built = await buildApp(config, { driverOverride: driver, quietLogs: true });
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('advertises hashcash in /v1/config when enabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/config' });
    const body = res.json();
    expect(body.abuseLayers.hashcash).toBe(true);
    expect(body.hashcash.difficulty).toBe(8);
  });

  it('mints a challenge, solves it, and the claim succeeds', async () => {
    const mint = await app.inject({
      method: 'POST',
      url: '/v1/challenge',
      payload: {},
      headers: { 'content-type': 'application/json' },
    });
    expect(mint.statusCode).toBe(200);
    const { challenge, difficulty } = mint.json();
    expect(difficulty).toBe(8);

    const nonce = await solveChallenge(challenge, difficulty);

    const claim = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR, hashcashSolution: `${challenge}#${nonce}` },
      headers: { 'content-type': 'application/json' },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().status).toBe('broadcast');
    expect(driver.sends).toHaveLength(1);
  });

  it('denies a claim without a hashcash solution when hashcash is enabled', async () => {
    const claim = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR },
      headers: { 'content-type': 'application/json' },
    });
    // Missing solution → hashcashCheck emits decision=challenge; pipeline maps to 202.
    expect(claim.statusCode).toBe(202);
    expect(claim.json().decision).toBe('challenge');
  });

  it('back-compat: still accepts the legacy powSolution field', async () => {
    const mint = await app.inject({ method: 'POST', url: '/v1/challenge', payload: {} });
    const { challenge, difficulty } = mint.json();
    const nonce = await solveChallenge(challenge, difficulty);
    const claim = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: {
        address: USER_ADDR.replace('1111', '3333'),
        powSolution: `${challenge}#${nonce}`,
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().status).toBe('broadcast');
  });
});
