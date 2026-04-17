import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticator } from '@otplib/preset-default';
import type { CurrencyDriver } from '@faucet/core';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';

const FAUCET_ADDR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';

class FakeDriver implements CurrencyDriver {
  readonly id = 'nimiq';
  readonly networks = ['test'] as const;
  async init(): Promise<void> {}
  parseAddress(s: string): string {
    const n = s.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!/^NQ[0-9]{2}(?: ?[0-9A-Z]{4}){8}$/.test(n)) throw new Error(`bad address: ${s}`);
    return n;
  }
  async getFaucetAddress() { return FAUCET_ADDR; }
  async getBalance() { return 10_000_000n; }
  async send() { return 'tx_x'; }
  async waitForConfirmation() {}
}

function parseCookie(setCookie: string | string[] | undefined, name: string): string | null {
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const line of arr) {
    const m = line.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (m) return decodeURIComponent(m[1]!);
  }
  return null;
}

describe('admin auth', () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-admin-auth-'));
    const config = ServerConfigSchema.parse({
      network: 'test',
      dataDir: tmp,
      signerDriver: 'rpc',
      rpcUrl: 'http://unused',
      walletAddress: FAUCET_ADDR,
      claimAmountLuna: '100000',
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

  it('first login seeds admin, returns provisioning URI, sets cookies', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { password: 'test-password-123' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.totpProvisioningUri).toBe('string');
    expect(body.totpProvisioningUri).toMatch(/^otpauth:\/\/totp\//);
    expect(typeof body.totpSecret).toBe('string');
    const setCookie = res.headers['set-cookie'];
    const session = parseCookie(setCookie, 'faucet_session');
    const csrf = parseCookie(setCookie, 'faucet_csrf');
    expect(session).toBeTruthy();
    expect(csrf).toBeTruthy();
    // stash secret for next test
    (globalThis as Record<string, unknown>).__totpSecret = body.totpSecret;
  });

  it('pre-enrolment enroll endpoint returns 409 after seed', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/auth/totp/enroll' });
    expect(res.statusCode).toBe(409);
  });

  it('login with wrong password is rejected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { password: 'nope' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('login without TOTP is rejected after enrolment', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { password: 'test-password-123' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('login with valid password + TOTP succeeds, and protected route is reachable', async () => {
    const secret = (globalThis as Record<string, unknown>).__totpSecret as string;
    const code = authenticator.generate(secret);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { password: 'test-password-123', totp: code },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const session = parseCookie(res.headers['set-cookie'], 'faucet_session');
    expect(session).toBeTruthy();
    const overview = await app.inject({
      method: 'GET',
      url: '/admin/overview',
      cookies: { faucet_session: session! },
    });
    expect(overview.statusCode).toBe(200);
    expect(typeof overview.json().balance).toBe('string');
    (globalThis as Record<string, unknown>).__sessionCookie = session;
  });

  it('protected route without cookie returns 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('/admin/audit-log without cookie returns 401 (fixes #43)', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/audit-log' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /admin/auth/reset without password returns 401 (fixes #44)', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/auth/reset' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /admin/auth/reset with wrong password returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/reset',
      payload: { password: 'wrong' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('logout revokes the session', async () => {
    const session = (globalThis as Record<string, unknown>).__sessionCookie as string;
    const out = await app.inject({
      method: 'POST',
      url: '/admin/auth/logout',
      cookies: { faucet_session: session },
    });
    expect(out.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: '/admin/overview',
      cookies: { faucet_session: session },
    });
    expect(after.statusCode).toBe(401);
  });
});
