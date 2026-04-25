/**
 * Regression tests for #86: idempotency-key scope. Pre-fix, the lookup was
 * keyed globally on `idempotency_key` alone, so two unrelated callers
 * could collide on the same string and read each other's claim status.
 * Post-fix:
 *
 *   - Authenticated callers: scoped by (integratorId, idempotencyKey).
 *     Two integrators with the same key never see each other's claim.
 *   - Unauthenticated callers: scoped by (idempotencyKey, address). Two
 *     anonymous callers with the same key but different addresses each
 *     get their own claim; same key + same address replays.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authenticator } from '@otplib/preset-default';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS, parseCookie } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const ADDR_A = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';
const ADDR_B = 'NQ00 2222 2222 2222 2222 2222 2222 2222 2222';

class FakeDriver extends BaseTestDriver {
  public sends: Array<{ to: string; amount: bigint }> = [];
  override async getBalance() { return 10_000_000n; }
  override async send(to: string, amount: bigint): Promise<string> {
    this.sends.push({ to, amount });
    return `tx_${this.sends.length}`;
  }
}

function signHmac(secret: string, parts: string[]): string {
  return createHmac('sha256', secret).update(parts.join('\n')).digest('hex');
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
    rateLimitPerIpPerDay: '100',
    adminPassword: 'test-password-123',
    dev: 'true',
    ...overrides,
  });
}

/** Seed admin + step-up TOTP, return cookies + secret for integrator-creation calls. */
async function adminLogin(app: Awaited<ReturnType<typeof buildApp>>['app']) {
  const seed = await app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    payload: { password: 'test-password-123' },
    headers: { 'content-type': 'application/json' },
  });
  return {
    session: parseCookie(seed.headers['set-cookie'], 'faucet_session')!,
    csrf: parseCookie(seed.headers['set-cookie'], 'faucet_csrf')!,
    totpSecret: seed.json().totpSecret as string,
  };
}

async function createIntegrator(
  app: Awaited<ReturnType<typeof buildApp>>['app'],
  auth: { session: string; csrf: string; totpSecret: string },
  id: string,
): Promise<{ apiKey: string; hmacSecret: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/integrators',
    payload: { id },
    headers: {
      'content-type': 'application/json',
      'x-faucet-csrf': auth.csrf,
      'x-faucet-totp': authenticator.generate(auth.totpSecret),
    },
    cookies: { faucet_session: auth.session, faucet_csrf: auth.csrf },
  });
  if (res.statusCode !== 201) throw new Error(`integrator create failed: ${res.statusCode} ${res.body}`);
  const body = res.json();
  return { apiKey: body.apiKey, hmacSecret: body.hmacSecret };
}

async function authenticatedClaim(
  app: Awaited<ReturnType<typeof buildApp>>['app'],
  integrator: { apiKey: string; hmacSecret: string },
  body: Record<string, unknown>,
) {
  const payload = JSON.stringify(body);
  const ts = Date.now().toString();
  const nonce = randomUUID();
  const sig = signHmac(integrator.hmacSecret, ['POST', '/v1/claim', ts, nonce, payload]);
  return app.inject({
    method: 'POST',
    url: '/v1/claim',
    payload,
    headers: {
      'content-type': 'application/json',
      'x-faucet-api-key': integrator.apiKey,
      'x-faucet-timestamp': ts,
      'x-faucet-nonce': nonce,
      'x-faucet-signature': sig,
    },
  });
}

describe('idempotency-key scoping (#86)', () => {
  let tmp: string;
  let apps: Array<Awaited<ReturnType<typeof buildApp>>['app']> = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-idem-'));
  });

  afterEach(async () => {
    for (const a of apps) await a.close();
    apps = [];
    rmSync(tmp, { recursive: true, force: true });
  });

  it('two integrators using the same idempotency key get distinct claims', async () => {
    const built = await buildApp(baseConfig(tmp), {
      driverOverride: new FakeDriver(),
      quietLogs: true,
    });
    apps.push(built.app);
    await built.app.ready();
    const auth = await adminLogin(built.app);
    const partnerA = await createIntegrator(built.app, auth, 'partner-a');
    const partnerB = await createIntegrator(built.app, auth, 'partner-b');

    const a = await authenticatedClaim(built.app, partnerA, {
      address: ADDR_A,
      idempotencyKey: 'shared-key',
    });
    expect(a.statusCode).toBe(200);
    const aBody = a.json();
    expect(aBody.idempotent).toBeUndefined();

    const b = await authenticatedClaim(built.app, partnerB, {
      address: ADDR_B,
      idempotencyKey: 'shared-key',
    });
    expect(b.statusCode).toBe(200);
    const bBody = b.json();
    // Different claim id — partner B did NOT read partner A's row.
    expect(bBody.id).not.toBe(aBody.id);
    expect(bBody.idempotent).toBeUndefined();
  });

  it('the same integrator replaying the same key returns the original claim', async () => {
    const built = await buildApp(baseConfig(tmp), {
      driverOverride: new FakeDriver(),
      quietLogs: true,
    });
    apps.push(built.app);
    await built.app.ready();
    const auth = await adminLogin(built.app);
    const partner = await createIntegrator(built.app, auth, 'partner-a');

    const first = await authenticatedClaim(built.app, partner, {
      address: ADDR_A,
      idempotencyKey: 'retry-me',
    });
    expect(first.statusCode).toBe(200);
    const firstId = first.json().id;

    const second = await authenticatedClaim(built.app, partner, {
      address: ADDR_A,
      idempotencyKey: 'retry-me',
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.idempotent).toBe(true);
    expect(secondBody.id).toBe(firstId);
  });

  it('unauthenticated callers: same key + different addresses get distinct claims', async () => {
    const built = await buildApp(baseConfig(tmp), {
      driverOverride: new FakeDriver(),
      quietLogs: true,
    });
    apps.push(built.app);
    await built.app.ready();

    const a = await built.app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: ADDR_A, idempotencyKey: 'shared-anon-key' },
      headers: { 'content-type': 'application/json' },
    });
    expect(a.statusCode).toBe(200);
    const aId = a.json().id;

    const b = await built.app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: ADDR_B, idempotencyKey: 'shared-anon-key' },
      headers: { 'content-type': 'application/json' },
    });
    expect(b.statusCode).toBe(200);
    const bBody = b.json();
    expect(bBody.id).not.toBe(aId);
    expect(bBody.idempotent).toBeUndefined();
  });

  it('unauthenticated callers: same key + same address replays the original', async () => {
    const built = await buildApp(baseConfig(tmp), {
      driverOverride: new FakeDriver(),
      quietLogs: true,
    });
    apps.push(built.app);
    await built.app.ready();

    const first = await built.app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: ADDR_A, idempotencyKey: 'anon-retry' },
      headers: { 'content-type': 'application/json' },
    });
    expect(first.statusCode).toBe(200);
    const firstId = first.json().id;

    const second = await built.app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: ADDR_A, idempotencyKey: 'anon-retry' },
      headers: { 'content-type': 'application/json' },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.idempotent).toBe(true);
    expect(secondBody.id).toBe(firstId);
  });
});
