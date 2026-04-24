/**
 * Regression tests for #87: the per-IP rate-limit and blocklist must use the
 * raw socket address when the upstream peer isn't in the trusted-proxy CIDR
 * allow-list. Before this fix, `trustProxy: true` made any client's
 * `X-Forwarded-For` authoritative for `req.ip`, which let a single attacker
 * rotate spoofed IPs per request to bypass per-IP quotas.
 *
 * The test drives `/v1/claim` via `app.inject`, which presents the request
 * to Fastify as if it originated at `127.0.0.1`. With the default config
 * (`trustedProxyCidrs` empty, `dev=false`), XFF must be ignored: repeat
 * requests with distinct XFF headers should still hit the same per-IP cap.
 * With loopback allow-listed (simulated via `dev=true`), XFF is honoured
 * and distinct XFF values bypass the cap — this is the operator-opt-in path
 * for legitimate reverse-proxy deployments.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

function baseConfig(dir: string, overrides: Record<string, unknown> = {}) {
  return ServerConfigSchema.parse({
    geoipBackend: 'none',
    network: 'test',
    dataDir: dir,
    signerDriver: 'rpc',
    rpcUrl: 'http://unused',
    walletAddress: FAUCET_ADDR,
    claimAmountLuna: '100000',
    rateLimitPerMinute: '1000',
    rateLimitPerIpPerDay: '2',
    adminPassword: 'test-password-123',
    tlsRequired: false,
    corsOrigins: 'https://example.test',
    ...overrides,
  });
}

describe('trustProxy CIDR allow-list (#87)', () => {
  let tmp: string;
  let apps: Array<Awaited<ReturnType<typeof buildApp>>['app']> = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-trustproxy-'));
  });

  afterEach(async () => {
    for (const a of apps) await a.close();
    apps = [];
    rmSync(tmp, { recursive: true, force: true });
  });

  it('ignores spoofed X-Forwarded-For when the upstream is not in the trust list', async () => {
    // Default config: no proxy trusted, non-dev — the only IP the server
    // ever sees for a request is its socket peer (127.0.0.1 via inject).
    const config = baseConfig(tmp);
    const built = await buildApp(config, { driverOverride: new FakeDriver(), quietLogs: true });
    apps.push(built.app);
    await built.app.ready();

    const send = (xff: string) =>
      built.app.inject({
        method: 'POST',
        url: '/v1/claim',
        payload: { address: USER_ADDR },
        headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
      });

    // rateLimitPerIpPerDay=2. Three attempts from "distinct" spoofed IPs —
    // if the spoof were honoured each would be a separate bucket (all 200).
    // Because XFF is ignored, the third one hits the per-IP cap and is denied.
    const a = await send('203.0.113.1');
    const b = await send('203.0.113.2');
    const c = await send('203.0.113.3');
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(c.statusCode).toBe(403);
    expect(c.json().reason).toMatch(/daily cap/);
  });

  it('honours X-Forwarded-For when the upstream peer is in the trust list (dev → loopback auto-trusted)', async () => {
    // dev=true auto-adds 127.0.0.1/32 + ::1/128 to the trust list so
    // legitimate reverse-proxy deployments keep working under test. With
    // loopback trusted, distinct XFF values become distinct req.ip buckets.
    const config = baseConfig(tmp, { dev: 'true' });
    const built = await buildApp(config, { driverOverride: new FakeDriver(), quietLogs: true });
    apps.push(built.app);
    await built.app.ready();

    const send = (xff: string) =>
      built.app.inject({
        method: 'POST',
        url: '/v1/claim',
        payload: { address: USER_ADDR },
        headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
      });

    // Same three calls: each XFF is a fresh per-IP bucket so all succeed.
    const a = await send('203.0.113.11');
    const b = await send('203.0.113.12');
    const c = await send('203.0.113.13');
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(c.statusCode).toBe(200);
  });
});
