import { describe, expect, it } from 'vitest';
import { buildFeatures } from '../src/features.js';
import { defaultRulesModel } from '../src/rules.js';
import type { RecentClaimsQuery } from '../src/index.js';

function stubQuery(overrides: Partial<{ ip: number; address: number; uid: number }> = {}): RecentClaimsQuery {
  return {
    async byIp() {
      return overrides.ip ?? 0;
    },
    async byAddress() {
      return overrides.address ?? 0;
    },
    async byUid() {
      return overrides.uid ?? 0;
    },
  };
}

const ADDR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';

describe('abuse-ai rules model', () => {
  it('extracts features from a stub query', async () => {
    const features = await buildFeatures({
      req: {
        address: ADDR,
        ip: '1.2.3.4',
        requestedAt: Date.UTC(2024, 0, 1, 12, 0, 0),
      },
      query: stubQuery({ ip: 7, address: 2 }),
    });
    expect(features.claimsByIp1h).toBe(7);
    expect(features.claimsByIp24h).toBe(7);
    expect(features.claimsByAddress1h).toBe(2);
    expect(features.claimsByUid24h).toBe(0);
    expect(features.hourOfDayUtc).toBe(12);
    expect(features.hostContextVerified).toBe(0.5);
  });

  it('returns no contributions for a perfectly clean baseline', () => {
    const model = defaultRulesModel();
    const contribs = model.score({
      claimsByIp1h: 0,
      claimsByIp24h: 0,
      claimsByAddress1h: 0,
      claimsByAddress24h: 0,
      claimsByUid24h: 0,
      fingerprintEntropy: 0.8,
      hostContextVerified: 1,
      addressIsFresh: 0,
      hourOfDayUtc: 14,
    });
    expect(contribs).toHaveLength(0);
  });

  it('fires address-repeat rule when claimsByAddress1h > 1', () => {
    const model = defaultRulesModel();
    const contribs = model.score({
      claimsByIp1h: 0,
      claimsByIp24h: 0,
      claimsByAddress1h: 3,
      claimsByAddress24h: 0,
      claimsByUid24h: 0,
      fingerprintEntropy: 0.8,
      hostContextVerified: 1,
      addressIsFresh: 0,
      hourOfDayUtc: 14,
    });
    expect(contribs.some((c) => c.feature === 'claimsByAddress1h')).toBe(true);
  });

  it('caps IP burst contribution at 0.5', () => {
    const model = defaultRulesModel();
    const contribs = model.score({
      claimsByIp1h: 100,
      claimsByIp24h: 0,
      claimsByAddress1h: 0,
      claimsByAddress24h: 0,
      claimsByUid24h: 0,
      fingerprintEntropy: 0.8,
      hostContextVerified: 1,
      addressIsFresh: 0,
      hourOfDayUtc: 14,
    });
    const ip1h = contribs.find((c) => c.feature === 'claimsByIp1h');
    expect(ip1h?.contribution).toBe(0.5);
  });
});
