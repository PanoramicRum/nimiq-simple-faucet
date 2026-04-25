import { describe, expect, it } from 'vitest';
import type { ClaimRequest } from '@faucet/core';
import { geoipCheck, type GeoIpResolver, type GeoIpResult } from '../src/index.js';

function stubResolver(result: Partial<GeoIpResult>): GeoIpResolver {
  return {
    id: 'stub',
    async lookup() {
      return {
        country: result.country ?? null,
        asn: result.asn ?? null,
        asnOrg: result.asnOrg ?? null,
        isVpn: result.isVpn,
        isHosting: result.isHosting,
        isTor: result.isTor,
      };
    },
  };
}

const req = (ip = '8.8.8.8'): ClaimRequest => ({
  address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
  ip,
  requestedAt: Date.now(),
});

describe('geoipCheck', () => {
  it('allows when there is no policy and no signals', async () => {
    const check = geoipCheck({ resolver: stubResolver({ country: 'DE', asn: 3320 }) });
    const r = await check.check(req());
    expect(r.score).toBe(0);
    expect(r.decision).toBeUndefined();
  });

  it('skips the check for private IPs', async () => {
    const check = geoipCheck({ resolver: stubResolver({ country: 'DE' }) });
    const r = await check.check(req('10.0.0.1'));
    expect(r.score).toBe(0);
    expect(r.signals.skipped).toBe('private-ip');
  });

  it('denies deny-listed countries', async () => {
    const check = geoipCheck({
      resolver: stubResolver({ country: 'KP' }),
      policy: { denyCountries: ['KP'] },
    });
    const r = await check.check(req());
    expect(r.decision).toBe('deny');
    expect(r.reason).toContain('KP');
  });

  it('denies countries outside the allow-list', async () => {
    const check = geoipCheck({
      resolver: stubResolver({ country: 'RU' }),
      policy: { allowCountries: ['DE', 'CH'] },
    });
    const r = await check.check(req());
    expect(r.decision).toBe('deny');
  });

  it('hard-denies an unresolved country when an allow-list is active (#103)', async () => {
    // Resolver returns null country (new IP block, anonymizing proxy,
    // stale DB). Pre-fix this returned a soft 0.9 score that could be
    // averaged below threshold by clean signals from other layers; an
    // allow-list means "only these countries" so unknown is by
    // definition not in it.
    const check = geoipCheck({
      resolver: stubResolver({ country: null, asn: 65000 }),
      policy: { allowCountries: ['US'] },
    });
    const r = await check.check(req());
    expect(r.decision).toBe('deny');
    expect(r.score).toBe(1);
    expect(r.reason).toMatch(/country unknown while allow-list active/);
  });

  it('does not penalise an unresolved country when no allow-list is configured', async () => {
    const check = geoipCheck({
      resolver: stubResolver({ country: null }),
      policy: {},
    });
    const r = await check.check(req());
    expect(r.decision).toBeUndefined();
    expect(r.score).toBe(0);
  });

  it('denies explicit ASNs', async () => {
    const check = geoipCheck({
      resolver: stubResolver({ country: 'DE', asn: 16509, asnOrg: 'Amazon.com, Inc.' }),
      policy: { denyAsns: [16509] },
    });
    const r = await check.check(req());
    expect(r.decision).toBe('deny');
  });

  it('denies hosting providers via the ASN-org heuristic when denyHosting is on', async () => {
    const check = geoipCheck({
      resolver: stubResolver({ country: 'US', asn: 16509, asnOrg: 'Amazon.com, Inc.' }),
      policy: { denyHosting: true },
    });
    const r = await check.check(req());
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/hosting/);
  });

  it('soft-scores hosting providers when denyHosting is off', async () => {
    const check = geoipCheck({
      resolver: stubResolver({ country: 'US', asn: 16509, asnOrg: 'Amazon.com, Inc.' }),
    });
    const r = await check.check(req());
    expect(r.decision).toBeUndefined();
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(0.8);
  });

  it('soft-skips when the resolver throws', async () => {
    const failing: GeoIpResolver = {
      id: 'failing',
      async lookup() {
        throw new Error('nope');
      },
    };
    const check = geoipCheck({ resolver: failing });
    const r = await check.check(req());
    expect(r.score).toBe(0);
    expect(r.reason).toMatch(/lookup failed/);
  });

  // Pre-fix this asserted the soft-0.9-no-decision behaviour. After #103
  // the contract is hard deny — covered by the new "hard-denies an
  // unresolved country when an allow-list is active" test above.
});
