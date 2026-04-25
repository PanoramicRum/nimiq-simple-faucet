/**
 * Regression tests for #88: admin-scoped MCP tools must require either an
 * admin session with a TOTP step-up, OR (deprecated fallback) a valid static
 * FAUCET_ADMIN_MCP_TOKEN. With the static path disabled via
 * FAUCET_ADMIN_MCP_ALLOW_STATIC_TOKEN=false, only the session path works.
 *
 * We test the auth resolver `resolveAdminPrincipal` directly rather than
 * driving JSON-RPC tool calls through the HTTP transport. The resolver IS
 * the security boundary; the MCP SDK's transport plumbing is out of scope
 * for these tests. The existing mcp.e2e.test.ts already covers the per-tool
 * guard (`requireAdminPrincipal`) and tool registration.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authenticator } from '@otplib/preset-default';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { resolveAdminPrincipal } from '../src/mcp/index.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS, parseCookie } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const PASSWORD = 'test-password-123';

class FakeDriver extends BaseTestDriver {
  override async getBalance(): Promise<bigint> { return 42n; }
  override async send(): Promise<string> { return 'tx_x'; }
}

function baseConfig(dir: string, overrides: Record<string, unknown> = {}) {
  return ServerConfigSchema.parse({
    geoipBackend: 'none',
    network: 'test',
    dataDir: dir,
    signerDriver: 'rpc',
    rpcUrl: 'http://unused',
    walletAddress: FAUCET_ADDR,
    claimAmountLuna: '100000',
    adminPassword: PASSWORD,
    dev: 'true',
    ...overrides,
  });
}

/**
 * Build a minimal FastifyRequest-ish object carrying the cookies and headers
 * the resolver actually consults. The resolver only reads `req.cookies` and
 * `req.headers`, so a typed cast from this shape is safe.
 */
function mockReq(opts: {
  sessionCookie?: string;
  staticToken?: string;
  totpCode?: string;
}): FastifyRequest {
  const cookies: Record<string, string> = {};
  if (opts.sessionCookie) cookies.faucet_session = opts.sessionCookie;
  const headers: Record<string, string> = {};
  if (opts.staticToken) headers['x-faucet-admin-token'] = opts.staticToken;
  if (opts.totpCode) headers['x-faucet-totp'] = opts.totpCode;
  return { cookies, headers } as unknown as FastifyRequest;
}

/** Seed + step-up a session; return the session cookie + TOTP secret. */
async function seedAndStepUp(app: Awaited<ReturnType<typeof buildApp>>['app']) {
  const first = await app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    payload: { password: PASSWORD },
    headers: { 'content-type': 'application/json' },
  });
  expect(first.statusCode).toBe(200);
  const totpSecret = first.json().totpSecret as string;
  const totp = authenticator.generate(totpSecret);
  const second = await app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    payload: { password: PASSWORD, totp },
    headers: { 'content-type': 'application/json' },
  });
  expect(second.statusCode).toBe(200);
  const session = parseCookie(second.headers['set-cookie'], 'faucet_session');
  return { session: session!, totpSecret };
}

describe('resolveAdminPrincipal (#88)', () => {
  let tmp: string;
  let apps: Array<Awaited<ReturnType<typeof buildApp>>['app']> = [];
  let ctxs: Array<Awaited<ReturnType<typeof buildApp>>['ctx']> = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-mcp-auth-'));
  });

  afterEach(async () => {
    for (const a of apps) await a.close();
    apps = [];
    ctxs = [];
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns null when no auth is presented', async () => {
    const built = await buildApp(baseConfig(tmp), {
      driverOverride: new FakeDriver(),
      quietLogs: true,
    });
    apps.push(built.app);
    ctxs.push(built.ctx);
    await built.app.ready();

    const principal = await resolveAdminPrincipal(built.ctx, mockReq({}));
    expect(principal).toBeNull();
  });

  it('resolves a session principal when the session has a recent TOTP step-up', async () => {
    const built = await buildApp(baseConfig(tmp), {
      driverOverride: new FakeDriver(),
      quietLogs: true,
    });
    apps.push(built.app);
    ctxs.push(built.ctx);
    await built.app.ready();

    const { session } = await seedAndStepUp(built.app);
    const principal = await resolveAdminPrincipal(
      built.ctx,
      mockReq({ sessionCookie: session }),
    );
    expect(principal).toEqual({ kind: 'session', userId: 'admin' });
  });

  it('returns null when a session exists but has no step-up and no TOTP header', async () => {
    const built = await buildApp(baseConfig(tmp), {
      driverOverride: new FakeDriver(),
      quietLogs: true,
    });
    apps.push(built.app);
    ctxs.push(built.ctx);
    await built.app.ready();

    // Seed-login only — leaves totpStepUpAt null on the session row.
    const seed = await built.app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { password: PASSWORD },
      headers: { 'content-type': 'application/json' },
    });
    const session = parseCookie(seed.headers['set-cookie'], 'faucet_session');
    expect(session).toBeTruthy();

    const principal = await resolveAdminPrincipal(
      built.ctx,
      mockReq({ sessionCookie: session! }),
    );
    expect(principal).toBeNull();
  });

  it('accepts a live TOTP header as step-up when the session has none recorded yet', async () => {
    const built = await buildApp(baseConfig(tmp), {
      driverOverride: new FakeDriver(),
      quietLogs: true,
    });
    apps.push(built.app);
    ctxs.push(built.ctx);
    await built.app.ready();

    // Seed-login only — no second login, so totpStepUpAt is null. We pass a
    // live TOTP code via header so the resolver records step-up on the fly.
    const seed = await built.app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { password: PASSWORD },
      headers: { 'content-type': 'application/json' },
    });
    const session = parseCookie(seed.headers['set-cookie'], 'faucet_session');
    const totpSecret = seed.json().totpSecret as string;
    const totp = authenticator.generate(totpSecret);

    const principal = await resolveAdminPrincipal(
      built.ctx,
      mockReq({ sessionCookie: session!, totpCode: totp }),
    );
    expect(principal).toEqual({ kind: 'session', userId: 'admin' });
  });

  it('accepts the static token when the allow-static flag is on', async () => {
    const built = await buildApp(
      baseConfig(tmp, { adminMcpToken: 'static-abc', adminMcpAllowStaticToken: true }),
      { driverOverride: new FakeDriver(), quietLogs: true },
    );
    apps.push(built.app);
    ctxs.push(built.ctx);
    await built.app.ready();

    const principal = await resolveAdminPrincipal(
      built.ctx,
      mockReq({ staticToken: 'static-abc' }),
    );
    expect(principal).toEqual({ kind: 'static-token' });
  });

  it('ignores the static token when the allow-static flag is off', async () => {
    const built = await buildApp(
      baseConfig(tmp, { adminMcpToken: 'static-abc', adminMcpAllowStaticToken: false }),
      { driverOverride: new FakeDriver(), quietLogs: true },
    );
    apps.push(built.app);
    ctxs.push(built.ctx);
    await built.app.ready();

    const principal = await resolveAdminPrincipal(
      built.ctx,
      mockReq({ staticToken: 'static-abc' }),
    );
    expect(principal).toBeNull();
  });

  it('rejects a wrong static token even with the flag on', async () => {
    const built = await buildApp(
      baseConfig(tmp, { adminMcpToken: 'right-abc', adminMcpAllowStaticToken: true }),
      { driverOverride: new FakeDriver(), quietLogs: true },
    );
    apps.push(built.app);
    ctxs.push(built.ctx);
    await built.app.ready();

    const principal = await resolveAdminPrincipal(
      built.ctx,
      mockReq({ staticToken: 'wrong-abc' }),
    );
    expect(principal).toBeNull();
  });
});
