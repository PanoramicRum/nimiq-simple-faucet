import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GeoIpResolver, GeoIpResult } from '@faucet/abuse-geoip';
import type { CurrencyDriver } from '@faucet/core';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';

const FAUCET_ADDR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';
const USER_ADDR = 'NQ00 4444 4444 4444 4444 4444 4444 4444 4444';

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

class ScriptedResolver implements GeoIpResolver {
  readonly id = 'scripted';
  constructor(private readonly map: Record<string, GeoIpResult>) {}
  async lookup(ip: string): Promise<GeoIpResult> {
    return (
      this.map[ip] ?? {
        country: null,
        asn: null,
        asnOrg: null,
      }
    );
  }
}

describe('geoip abuse layer (e2e)', () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let driver: StubDriver;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-geoip-'));
    const config = ServerConfigSchema.parse({
      network: 'test',
      dataDir: tmp,
      signerDriver: 'rpc',
      rpcUrl: 'http://unused',
      walletAddress: FAUCET_ADDR,
      claimAmountLuna: '100000',
      rateLimitPerIpPerDay: '50',
      adminPassword: 'test-password-123',
      geoipBackend: 'maxmind',
      geoipMaxmindCountryDb: '/not-used-because-resolver-is-overridden.mmdb',
      geoipDenyCountries: 'KP,IR',
      geoipDenyVpn: 'true',
      geoipDenyHosting: 'true',
      dev: 'true',
    });
    driver = new StubDriver();
    // Public-looking IPs so the geoip check doesn't short-circuit on "private-ip".
    const resolver = new ScriptedResolver({
      '203.0.113.10': { country: 'DE', asn: 3320, asnOrg: 'Deutsche Telekom AG' },
      '203.0.113.20': { country: 'KP', asn: 1, asnOrg: 'Star JV' },
      '203.0.113.30': { country: 'US', asn: 16509, asnOrg: 'Amazon.com, Inc.' },
      '203.0.113.40': { country: 'US', asn: 22989, asnOrg: 'NordVPN S.A.' },
    });
    const built = await buildApp(config, {
      driverOverride: driver,
      geoipResolverOverride: resolver,
      quietLogs: true,
    });
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('advertises geoip in /v1/config when enabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(res.json().abuseLayers.geoip).toBe(true);
  });

  it('allows a clean residential IP', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR },
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('broadcast');
  });

  it('denies a claim from a deny-listed country', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR.replace('4444', '5555') },
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.20' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().decision).toBe('deny');
    expect(res.json().reason).toMatch(/KP/);
  });

  it('denies a claim from a VPN / proxy ASN (denyVpn)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR.replace('4444', '6666') },
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.40' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().decision).toBe('deny');
    expect(res.json().reason).toMatch(/VPN|proxy/i);
  });

  it('flags hosting providers and escalates based on score thresholds', async () => {
    // Hosting heuristic scores 0.85 and also emits decision=deny → expect 403.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claim',
      payload: { address: USER_ADDR.replace('4444', '7777') },
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.30' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().reason).toMatch(/hosting/);
  });
});
