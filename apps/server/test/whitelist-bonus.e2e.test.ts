import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { authenticator } from '@otplib/preset-default';
import { canonicalizeHostContext, type HostContext } from '@faucet/core';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS, parseCookie } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;
const ADMIN_PASSWORD = 'test-password-123';
const A1 = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';
const A2 = 'NQ00 2222 2222 2222 2222 2222 2222 2222 2222';

class FakeNimiqDriver extends BaseTestDriver {
  public sends: Array<{ to: string; amount: bigint }> = [];
  public balance = 100_000_000n;
  override async getBalance() {
    return this.balance;
  }
  override async send(to: string, amount: bigint): Promise<string> {
    this.sends.push({ to, amount });
    this.balance -= amount;
    return `tx_${this.sends.length}`;
  }
  override async waitForConfirmation(): Promise<void> {}
}

const open: Array<{ app: FastifyInstance; tmp: string }> = [];

async function makeApp(
  overrides: Record<string, unknown> = {},
  driver: FakeNimiqDriver = new FakeNimiqDriver(),
): Promise<{ app: FastifyInstance; driver: FakeNimiqDriver }> {
  const tmp = mkdtempSync(join(tmpdir(), 'faucet-whitelist-e2e-'));
  const config = ServerConfigSchema.parse({
    geoipBackend: 'none',
    network: 'test',
    dataDir: tmp,
    signerDriver: 'rpc',
    rpcUrl: 'http://unused',
    walletAddress: FAUCET_ADDR,
    claimAmountLuna: '100000',
    rateLimitPerIpPerDay: '100',
    adminPassword: ADMIN_PASSWORD,
    automaticRewardsEnabled: 'true',
    automaticRewardsBaselineNim: '10', // 1_000_000 luna baseline
    whitelistRewardsEnabled: 'true',
    whitelistBonusPercent: '50',
    dev: 'true',
    rejectDelayMsMin: '0',
    // dev mode trusts loopback XFF, so tests can vary the client IP.
    ...overrides,
  });
  const { app } = await buildApp(config, { driverOverride: driver, quietLogs: true });
  await app.ready();
  open.push({ app, tmp });
  return { app, driver };
}

function claim(app: FastifyInstance, address: string, ip: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/claim',
    payload: { address },
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

function claimWithContext(
  app: FastifyInstance,
  address: string,
  ip: string,
  hostContext: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: '/v1/claim',
    payload: { address, hostContext },
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

async function login(
  app: FastifyInstance,
): Promise<{ session: string; csrf: string; totpSecret: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    payload: { password: ADMIN_PASSWORD },
    headers: { 'content-type': 'application/json' },
  });
  return {
    session: parseCookie(res.headers['set-cookie'], 'faucet_session')!,
    csrf: parseCookie(res.headers['set-cookie'], 'faucet_csrf')!,
    totpSecret: res.json().totpSecret as string,
  };
}

async function createIntegrator(
  app: FastifyInstance,
  auth: { session: string; csrf: string; totpSecret: string },
  id: string,
): Promise<{ id: string; apiKey: string; hmacSecret: string }> {
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
  if (res.statusCode !== 201) {
    throw new Error(`integrator create failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json();
  return { id, apiKey: body.apiKey, hmacSecret: body.hmacSecret };
}

function signHmac(secret: string, parts: string[]): string {
  return createHmac('sha256', secret).update(parts.join('\n')).digest('hex');
}

/** Full integrator request HMAC (path the uid whitelist requires). */
function integratorClaim(
  app: FastifyInstance,
  integrator: { apiKey: string; hmacSecret: string },
  body: Record<string, unknown>,
  ip: string,
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
      'x-forwarded-for': ip,
    },
  });
}

/** Per-field hostContext signature (§1.4) — must NEVER grant whitelist payouts. */
function perFieldSignedContext(
  integrator: { id: string; hmacSecret: string },
  ctx: Record<string, unknown>,
): Record<string, unknown> {
  const canonical = canonicalizeHostContext(ctx as HostContext);
  const hmac = createHmac('sha256', integrator.hmacSecret).update(canonical).digest('base64');
  return { ...ctx, signature: `${integrator.id}:${hmac}` };
}

function adminReq(
  app: FastifyInstance,
  auth: { session: string; csrf: string },
  method: 'POST' | 'PATCH' | 'DELETE' | 'GET',
  url: string,
  body?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    ...(body !== undefined ? { payload: body } : {}),
    headers: {
      // Only claim a JSON body when there is one — Fastify 400s on an
      // empty body with a JSON content-type (e.g. the DELETE below).
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'x-faucet-csrf': auth.csrf,
    },
    cookies: { faucet_session: auth.session, faucet_csrf: auth.csrf },
  });
}

afterEach(async () => {
  for (const { app, tmp } of open.splice(0)) {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

describe('whitelist bonus (§2.4.5)', () => {
  it('pays the global default bonus to a listed address (normalized on insert)', async () => {
    const { app, driver } = await makeApp();
    const auth = await login(app);
    // Lowercase, messy spacing — the write path canonicalizes.
    const created = await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1.toLowerCase(),
    });
    expect(created.statusCode).toBe(201);

    const res = await claim(app, A1, '10.0.0.1');
    expect(res.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_500_000n); // baseline + 50% global default

    // A non-listed address pays the plain baseline.
    const res2 = await claim(app, A2, '10.0.0.2');
    expect(res2.statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(1_000_000n);
  });

  it('per-entry percent and exact amount override the global default', async () => {
    const { app, driver } = await makeApp();
    const auth = await login(app);
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1,
      bonusPercent: 20,
    });
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A2,
      exactAmountNim: 25,
    });

    const r1 = await claim(app, A1, '10.0.0.1');
    expect(r1.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_200_000n); // per-entry 20%, not global 50%

    const r2 = await claim(app, A2, '10.0.0.2');
    expect(r2.statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(2_500_000n); // exact 25 NIM
  });

  it('a whitelist grant suppresses the first-time boost', async () => {
    const { app, driver } = await makeApp({ firstTimeBoostPercent: '100' });
    const auth = await login(app);
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', { kind: 'address', value: A1 });

    // Listed first-timer: whitelist bonus (50%) wins over the 100% boost.
    const r1 = await claim(app, A1, '10.0.0.1');
    expect(r1.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_500_000n);

    // Non-listed first-timer still gets the first-time boost.
    const r2 = await claim(app, A2, '10.0.0.2');
    expect(r2.statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(2_000_000n);
  });

  it('a whitelist grant suppresses the repeat-user reduction', async () => {
    const { app, driver } = await makeApp({
      repeatReductionDailyThreshold: '1',
      repeatReductionDailyPercent: '40',
    });
    const auth = await login(app);
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1,
      bonusPercent: 20,
    });

    // Two paid claims to A1 → the daily tier (≥1) would reduce a normal
    // claimant, but A1 is whitelisted: each pays the 20% bonus, never reduced.
    const r1 = await claim(app, A1, '10.0.0.1');
    expect(r1.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_200_000n);
    const r2 = await claim(app, A1, '10.0.0.2');
    expect(r2.statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(1_200_000n);
  });

  it('the percent form stacks with low-balance scaling end-to-end', async () => {
    const driver = new FakeNimiqDriver();
    driver.balance = 5_000_000n; // 50 NIM < 100 NIM threshold → low-balance active
    const { app } = await makeApp(
      { lowBalanceThresholdNim: '100', lowBalanceReductionPercent: '25' },
      driver,
    );
    const auth = await login(app);
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1,
      bonusPercent: 50,
    });

    const res = await claim(app, A1, '10.0.0.1');
    expect(res.statusCode).toBe(200);
    // 1_000_000 − 250_000 (low-balance) + 500_000 (whitelist) = 1_250_000
    expect(driver.sends[0]?.amount).toBe(1_250_000n);
  });

  it('the toggle is a live kill switch and /v1/config stays at the baseline', async () => {
    const { app, driver } = await makeApp();
    const auth = await login(app);
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', { kind: 'address', value: A1 });

    // Public config never leaks per-claimant bonuses.
    const pub = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(pub.json().claimAmountLuna).toBe('1000000');

    const r1 = await claim(app, A1, '10.0.0.1');
    expect(driver.sends[0]?.amount).toBe(1_500_000n);

    const patched = await adminReq(app, auth, 'PATCH', '/admin/config', {
      whitelistRewardsEnabled: false,
    });
    expect(patched.statusCode).toBe(200);

    const r2 = await claim(app, A1, '10.0.0.2');
    expect(r2.statusCode).toBe(200);
    expect(driver.sends[1]?.amount).toBe(1_000_000n); // entry still stored, rule off

    // Effective state is visible to the admin.
    const cfg = await adminReq(app, auth, 'GET', '/admin/config');
    expect(cfg.json().base.whitelistRewardsEnabled).toBe(false);
    expect(cfg.json().base.whitelistBonusPercent).toBe(50);
  });

  it('duplicate (kind, value) is a 409; removing the entry restores the baseline', async () => {
    const { app, driver } = await makeApp();
    const auth = await login(app);
    const first = await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1,
    });
    const { id } = first.json() as { id: string };

    const dup = await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1.toLowerCase(), // canonicalizes to the same value
    });
    expect(dup.statusCode).toBe(409);

    const removed = await adminReq(app, auth, 'DELETE', `/admin/reward-whitelist/${id}`);
    expect(removed.statusCode).toBe(200);

    const res = await claim(app, A1, '10.0.0.1');
    expect(res.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n);
  });

  it('an exact amount above the wallet balance is refused opaquely', async () => {
    const driver = new FakeNimiqDriver();
    driver.balance = 1_500_000n; // < exact 25 NIM
    const { app } = await makeApp({}, driver);
    const auth = await login(app);
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1,
      exactAmountNim: 25,
    });

    const res = await claim(app, A1, '10.0.0.1');
    expect(res.statusCode).toBe(403);
    expect(Object.keys(res.json() as Record<string, unknown>).sort()).toEqual(['id', 'status']);
    expect(driver.sends).toHaveLength(0);

    // The refusal must not leak the whitelisted address's exact configured
    // amount to anonymous callers via the public rejected-row views.
    const summary = await app.inject({ method: 'GET', url: '/v1/stats/summary' });
    const blocked = (summary.json() as { recentBlocked: Array<{ address: string; amountLuna: string }> })
      .recentBlocked;
    const row = blocked.find((b) => b.address === A1);
    expect(row).toBeDefined();
    expect(row?.amountLuna).toBe('0'); // NOT '2500000' (the exact 25 NIM)

    const recent = await app.inject({ method: 'GET', url: '/v1/claims/recent?status=rejected' });
    const items = (recent.json() as { items: Array<{ address: string; amountLuna: string }> }).items;
    expect(items.find((i) => i.address === A1)?.amountLuna).toBe('0');
  });

  it('uid entries: the bound integrator gets the bonus via the full request HMAC', async () => {
    const { app, driver } = await makeApp();
    const auth = await login(app);
    const integrator = await createIntegrator(app, auth, 'partner-1');
    const created = await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'uid',
      value: 'partner-ci',
      integratorId: 'partner-1',
      exactAmountNim: 30,
    });
    expect(created.statusCode).toBe(201);

    const res = await integratorClaim(
      app,
      integrator,
      { address: A1, hostContext: { uid: 'partner-ci' } },
      '10.0.0.1',
    );
    expect(res.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(3_000_000n); // exact 30 NIM
  });

  it('SECURITY: a per-field-signed hostContext never grants the uid bonus (replay/redirect regression)', async () => {
    const { app, driver } = await makeApp();
    const auth = await login(app);
    const integrator = await createIntegrator(app, auth, 'partner-1');
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'uid',
      value: 'partner-ci',
      integratorId: 'partner-1',
      exactAmountNim: 30,
    });

    // An attacker replays a legitimately-signed context (valid per-field HMAC
    // from the real integrator) against their OWN address, with no api-key.
    // The per-field signature covers only the context fields — it must not
    // unlock the value-granting uid entry.
    const stolenContext = perFieldSignedContext(integrator, { uid: 'partner-ci' });
    const res = await claimWithContext(app, A2, '10.0.0.9', stolenContext);
    expect(res.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n); // plain baseline, no grant
  });

  it('uid entries: a different integrator presenting the same uid gets no bonus (binding)', async () => {
    const { app, driver } = await makeApp();
    const auth = await login(app);
    await createIntegrator(app, auth, 'partner-1');
    const other = await createIntegrator(app, auth, 'partner-2');
    await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'uid',
      value: 'partner-ci',
      integratorId: 'partner-1',
      bonusPercent: 100,
    });

    const res = await integratorClaim(
      app,
      other,
      { address: A1, hostContext: { uid: 'partner-ci' } },
      '10.0.0.1',
    );
    expect(res.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(1_000_000n); // baseline — entry bound to partner-1
  });

  it('matches regardless of address spacing (entry unspaced, claim spaced)', async () => {
    const { app, driver } = await makeApp();
    const auth = await login(app);
    // Operator lists the compact/no-space form (as copied from an API).
    const unspaced = A1.replace(/ /g, '');
    const created = await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: unspaced,
      exactAmountNim: 25,
    });
    expect(created.statusCode).toBe(201);

    // Claimant sends the user-friendly spaced form → must still match.
    const res = await claim(app, A1, '10.0.0.1');
    expect(res.statusCode).toBe(200);
    expect(driver.sends[0]?.amount).toBe(2_500_000n);
  });

  it('rejects a sub-luna exact amount at create (cannot silently round to 0)', async () => {
    const { app } = await makeApp();
    const auth = await login(app);
    const res = await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1,
      exactAmountNim: 0.000001, // < 1 luna
    });
    expect(res.statusCode).toBe(400);
  });

  it('uid entries require integratorId on create; address entries must not set it', async () => {
    const { app } = await makeApp();
    const auth = await login(app);
    const noBinding = await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'uid',
      value: 'partner-ci',
    });
    expect(noBinding.statusCode).toBe(400);
    const wrongBinding = await adminReq(app, auth, 'POST', '/admin/reward-whitelist', {
      kind: 'address',
      value: A1,
      integratorId: 'partner-1',
    });
    expect(wrongBinding.statusCode).toBe(400);
  });

  it('requires an admin session for the CRUD routes', async () => {
    const { app } = await makeApp();
    const unauthed = await app.inject({
      method: 'GET',
      url: '/admin/reward-whitelist',
      headers: { accept: 'application/json' },
    });
    expect(unauthed.statusCode).toBe(401);
  });
});
