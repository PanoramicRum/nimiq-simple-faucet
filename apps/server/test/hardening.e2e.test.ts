import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CurrencyDriver } from '@faucet/core';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';

const FAUCET_ADDR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';
const USER_ADDR = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';

class StubDriver implements CurrencyDriver {
  readonly id = 'nimiq';
  readonly networks = ['test'] as const;
  async init() {}
  parseAddress(s: string) {
    const n = s.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!/^NQ[0-9]{2}(?: ?[0-9A-Z]{4}){8}$/.test(n)) throw new Error(`bad: ${s}`);
    return n;
  }
  async getFaucetAddress() { return FAUCET_ADDR; }
  async getBalance() { return 0n; }
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
    rateLimitPerIpPerDay: '100',
    adminPassword: 'test-password-123',
    corsOrigins: 'https://example.test',
    ...overrides,
  });
}

describe('hardening', () => {
  let tmp: string;
  let apps: Array<Awaited<ReturnType<typeof buildApp>>['app']> = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-hardening-'));
  });

  afterEach(async () => {
    for (const a of apps) await a.close();
    apps = [];
    rmSync(tmp, { recursive: true, force: true });
  });

  it('sets helmet headers (CSP, frame-ancestors via CSP, referrer-policy)', async () => {
    const config = baseConfig(tmp, { dev: true, tlsRequired: false });
    const built = await buildApp(config, { driverOverride: new StubDriver(), quietLogs: true });
    apps.push(built.app);
    await built.app.ready();
    const res = await built.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(String(csp)).toMatch(/frame-ancestors 'none'/);
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('TLS guard: returns 426 without https indicator when tlsRequired=true and not dev', async () => {
    const config = baseConfig(tmp, { tlsRequired: true, dev: false });
    const built = await buildApp(config, { driverOverride: new StubDriver(), quietLogs: true });
    apps.push(built.app);
    await built.app.ready();
    const res = await built.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(426);
    expect(res.json().code).toBe('TLS_REQUIRED');
  });

  it('TLS guard: allows request when x-forwarded-proto: https is present', async () => {
    const config = baseConfig(tmp, { tlsRequired: true, dev: false });
    const built = await buildApp(config, { driverOverride: new StubDriver(), quietLogs: true });
    apps.push(built.app);
    await built.app.ready();
    const res = await built.app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('TLS guard bypassed when dev=true', async () => {
    const config = baseConfig(tmp, { dev: true, tlsRequired: true });
    const built = await buildApp(config, { driverOverride: new StubDriver(), quietLogs: true });
    apps.push(built.app);
    await built.app.ready();
    const res = await built.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });

  it('error handler: in prod mode a thrown error yields 500 with no stack', async () => {
    const config = baseConfig(tmp, { tlsRequired: false, dev: false });
    const built = await buildApp(config, { driverOverride: new StubDriver(), quietLogs: true });
    apps.push(built.app);
    built.app.get('/boom', async () => {
      throw new Error('boom with a secret token=shhh');
    });
    await built.app.ready();
    const res = await built.app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe('internal error');
    expect(body).not.toHaveProperty('stack');
    expect(body).not.toHaveProperty('message');
    expect(JSON.stringify(body)).not.toContain('shhh');
  });

  it('refuses to start with wildcard CORS when tlsRequired=true', async () => {
    const config = baseConfig(tmp, { tlsRequired: true, dev: false, corsOrigins: '*' });
    await expect(
      buildApp(config, { driverOverride: new StubDriver(), quietLogs: true }),
    ).rejects.toThrow(/Wildcard CORS/i);
  });

  it('POST /v1/claim with 20 KB body returns 413', async () => {
    const config = baseConfig(tmp, { dev: true, tlsRequired: false });
    const built = await buildApp(config, { driverOverride: new StubDriver(), quietLogs: true });
    apps.push(built.app);
    await built.app.ready();
    const big = 'x'.repeat(20 * 1024);
    const res = await built.app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR, captchaToken: big },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(413);
  });
});
