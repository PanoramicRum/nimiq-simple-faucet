import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticator } from '@otplib/preset-default';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS, parseCookie } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const USER_ADDR = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';

class FakeDriver extends BaseTestDriver {
  public sends: Array<{ to: string; amount: bigint }> = [];
  override async getBalance() { return 10_000_000n; }
  override async send(to: string, amount: bigint) {
    this.sends.push({ to, amount });
    return `tx_${this.sends.length}`;
  }
}

function signHmac(secret: string, parts: string[]): string {
  return createHmac('sha256', secret).update(parts.join('\n')).digest('hex');
}

let sharedAuth: { session: string; csrf: string; totpSecret: string } | undefined;
/**
 * Seed the admin user, then re-login with a TOTP code so the session
 * has `totpStepUpAt` recorded. Returns the cookies + the TOTP secret so
 * tests can mint fresh codes for the `X-Faucet-Totp` header that
 * `requireTotpStepUp` checks on every key-bearing route (#85).
 */
async function login(app: Awaited<ReturnType<typeof buildApp>>['app']): Promise<typeof sharedAuth & object> {
  if (sharedAuth) return sharedAuth;
  const seed = await app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    payload: { password: 'test-password-123' },
    headers: { 'content-type': 'application/json' },
  });
  const totpSecret = seed.json().totpSecret as string;
  sharedAuth = {
    session: parseCookie(seed.headers['set-cookie'], 'faucet_session')!,
    csrf: parseCookie(seed.headers['set-cookie'], 'faucet_csrf')!,
    totpSecret,
  };
  return sharedAuth;
}

function totp(secret: string): string {
  return authenticator.generate(secret);
}

describe('admin integrators', () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-admin-ints-'));
    const config = ServerConfigSchema.parse({ geoipBackend: "none",
      network: 'test',
      dataDir: tmp,
      signerDriver: 'rpc',
      rpcUrl: 'http://unused',
      walletAddress: FAUCET_ADDR,
      claimAmountLuna: '100000',
      rateLimitPerIpPerDay: '100',
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

  it('creates an integrator and the new key works on /v1/claim', async () => {
    const { session, csrf, totpSecret } = await login(app);
    const create = await app.inject({
      method: 'POST',
      url: '/admin/integrators',
      payload: { id: 'partner-a' },
      headers: {
        'content-type': 'application/json',
        'x-faucet-csrf': csrf,
        'x-faucet-totp': totp(totpSecret),
      },
      cookies: { faucet_session: session, faucet_csrf: csrf },
    });
    expect(create.statusCode).toBe(201);
    const body = create.json();
    expect(body.id).toBe('partner-a');
    expect(typeof body.apiKey).toBe('string');
    expect(typeof body.hmacSecret).toBe('string');

    const payload = JSON.stringify({ address: USER_ADDR });
    const ts = Date.now().toString();
    const nonce = randomUUID();
    const sig = signHmac(body.hmacSecret, ['POST', '/v1/claim', ts, nonce, payload]);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload,
      headers: {
        'content-type': 'application/json',
        'x-faucet-api-key': body.apiKey,
        'x-faucet-timestamp': ts,
        'x-faucet-nonce': nonce,
        'x-faucet-signature': sig,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('broadcast');
    (globalThis as Record<string, unknown>).__lastApiKey = body.apiKey;
    (globalThis as Record<string, unknown>).__lastHmac = body.hmacSecret;
  });

  it('rotate replaces the key, old key stops working', async () => {
    const { session, csrf, totpSecret } = await login(app);
    const oldKey = (globalThis as Record<string, unknown>).__lastApiKey as string;
    const oldSecret = (globalThis as Record<string, unknown>).__lastHmac as string;

    const rot = await app.inject({
      method: 'POST',
      url: '/admin/integrators/partner-a/rotate',
      payload: {},
      headers: {
        'content-type': 'application/json',
        'x-faucet-csrf': csrf,
        'x-faucet-totp': totp(totpSecret),
      },
      cookies: { faucet_session: session, faucet_csrf: csrf },
    });
    expect(rot.statusCode).toBe(200);
    const rotBody = rot.json();
    expect(rotBody.apiKey).not.toBe(oldKey);

    // Old key should now fail auth (unknown api key).
    const payload = JSON.stringify({ address: USER_ADDR });
    const ts = Date.now().toString();
    const nonce = randomUUID();
    const sig = signHmac(oldSecret, ['POST', '/v1/claim', ts, nonce, payload]);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload,
      headers: {
        'content-type': 'application/json',
        'x-faucet-api-key': oldKey,
        'x-faucet-timestamp': ts,
        'x-faucet-nonce': nonce,
        'x-faucet-signature': sig,
      },
    });
    expect(res.statusCode).toBe(401);

    // New key works.
    const ts2 = Date.now().toString();
    const nonce2 = randomUUID();
    const sig2 = signHmac(rotBody.hmacSecret, ['POST', '/v1/claim', ts2, nonce2, payload]);
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload,
      headers: {
        'content-type': 'application/json',
        'x-faucet-api-key': rotBody.apiKey,
        'x-faucet-timestamp': ts2,
        'x-faucet-nonce': nonce2,
        'x-faucet-signature': sig2,
      },
    });
    expect(ok.statusCode).toBe(200);
    (globalThis as Record<string, unknown>).__lastApiKey = rotBody.apiKey;
    (globalThis as Record<string, unknown>).__lastHmac = rotBody.hmacSecret;
  });

  it('rejects create / rotate / delete without TOTP step-up (#85)', async () => {
    const { session, csrf } = await login(app);
    // No `x-faucet-totp` header on any of these — `requireTotpStepUp`
    // must refuse with 403 before any DB mutation runs.
    const create = await app.inject({
      method: 'POST',
      url: '/admin/integrators',
      payload: { id: 'partner-no-totp' },
      headers: { 'content-type': 'application/json', 'x-faucet-csrf': csrf },
      cookies: { faucet_session: session, faucet_csrf: csrf },
    });
    expect(create.statusCode).toBe(403);

    const rot = await app.inject({
      method: 'POST',
      url: '/admin/integrators/partner-a/rotate',
      payload: {},
      headers: { 'content-type': 'application/json', 'x-faucet-csrf': csrf },
      cookies: { faucet_session: session, faucet_csrf: csrf },
    });
    expect(rot.statusCode).toBe(403);

    const del = await app.inject({
      method: 'DELETE',
      url: '/admin/integrators/partner-a',
      headers: { 'x-faucet-csrf': csrf },
      cookies: { faucet_session: session, faucet_csrf: csrf },
    });
    expect(del.statusCode).toBe(403);
  });

  it('rejects create with an invalid TOTP code (#85)', async () => {
    const { session, csrf } = await login(app);
    const create = await app.inject({
      method: 'POST',
      url: '/admin/integrators',
      payload: { id: 'partner-bad-totp' },
      headers: {
        'content-type': 'application/json',
        'x-faucet-csrf': csrf,
        'x-faucet-totp': '000000',
      },
      cookies: { faucet_session: session, faucet_csrf: csrf },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json().error).toMatch(/invalid totp/i);
  });

  it('list does not leak secrets', async () => {
    const { session } = await login(app);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/integrators',
      cookies: { faucet_session: session },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<Record<string, unknown>>;
    for (const i of items) {
      expect(i.apiKey).toBeUndefined();
      expect(i.hmacSecret).toBeUndefined();
      expect(i.apiKeyHash).toBeUndefined();
    }
  });

  it('delete revokes the integrator, key no longer works', async () => {
    const { session, csrf, totpSecret } = await login(app);
    const apiKey = (globalThis as Record<string, unknown>).__lastApiKey as string;
    const hmacSecret = (globalThis as Record<string, unknown>).__lastHmac as string;

    const del = await app.inject({
      method: 'DELETE',
      url: '/admin/integrators/partner-a',
      headers: { 'x-faucet-csrf': csrf, 'x-faucet-totp': totp(totpSecret) },
      cookies: { faucet_session: session, faucet_csrf: csrf },
    });
    expect(del.statusCode).toBe(200);

    const payload = JSON.stringify({ address: USER_ADDR });
    const ts = Date.now().toString();
    const nonce = randomUUID();
    const sig = signHmac(hmacSecret, ['POST', '/v1/claim', ts, nonce, payload]);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload,
      headers: {
        'content-type': 'application/json',
        'x-faucet-api-key': apiKey,
        'x-faucet-timestamp': ts,
        'x-faucet-nonce': nonce,
        'x-faucet-signature': sig,
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
