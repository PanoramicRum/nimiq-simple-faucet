import { describe, expect, it } from 'vitest';
import { aiCheck } from '../src/check.js';
import type { RecentClaimsQuery } from '../src/index.js';

const ADDR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';

function stubQuery(fn: {
  ip?: (ip: string, w: number) => number;
  address?: (a: string, w: number) => number;
  uid?: (u: string, w: number) => number;
} = {}): RecentClaimsQuery {
  return {
    async byIp(ip, w) {
      return fn.ip ? fn.ip(ip, w) : 0;
    },
    async byAddress(a, w) {
      return fn.address ? fn.address(a, w) : 0;
    },
    async byUid(u, w) {
      return fn.uid ? fn.uid(u, w) : 0;
    },
  };
}

describe('aiCheck', () => {
  it('clean baseline scores ~0 and has no hard decision', async () => {
    const check = aiCheck({ query: stubQuery() });
    const result = await check.check({
      address: ADDR,
      ip: '10.0.0.1',
      requestedAt: Date.UTC(2024, 0, 1, 14, 0, 0),
      fingerprint: { components: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, 1])) },
      hostContext: { uid: 'u1' },
      hostContextVerified: true,
    });
    expect(result.decision).toBeUndefined();
    expect(result.score).toBeLessThan(0.1);
  });

  it('heavy IP burst pushes to review or deny', async () => {
    const check = aiCheck({
      query: stubQuery({
        ip: (_ip, w) => (w <= 60 * 60_000 ? 20 : 50),
        address: () => 6,
        uid: () => 15,
      }),
    });
    const result = await check.check({
      address: ADDR,
      ip: '10.0.0.1',
      requestedAt: Date.UTC(2024, 0, 1, 3, 0, 0),
      fingerprint: { confidence: 0.1 },
      hostContext: { uid: 'u1' },
    });
    expect(['review', 'deny']).toContain(result.decision);
    expect(result.score).toBeGreaterThanOrEqual(0.65);
  });

  it('repeated same-address bumps the score', async () => {
    const clean = aiCheck({ query: stubQuery() });
    const bumped = aiCheck({
      query: stubQuery({
        address: (_a, w) => (w <= 60 * 60_000 ? 3 : 0),
      }),
    });
    const req = {
      address: ADDR,
      ip: '10.0.0.1',
      requestedAt: Date.UTC(2024, 0, 1, 14, 0, 0),
      fingerprint: { components: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, 1])) },
      hostContext: { uid: 'u1' },
      hostContextVerified: true,
    };
    const a = await clean.check(req);
    const b = await bumped.check(req);
    expect(b.score).toBeGreaterThan(a.score);
  });

  it('soft-skips when the query throws', async () => {
    const check = aiCheck({
      query: {
        async byIp() {
          throw new Error('db down');
        },
        async byAddress() {
          return 0;
        },
        async byUid() {
          return 0;
        },
      },
    });
    const result = await check.check({
      address: ADDR,
      ip: '10.0.0.1',
      requestedAt: Date.UTC(2024, 0, 1, 14, 0, 0),
    });
    expect(result.decision).toBeUndefined();
    expect(result.score).toBe(0);
    expect(result.reason).toMatch(/soft-skipping/);
  });

  it('populates top-3 contributions in signals', async () => {
    const check = aiCheck({
      query: stubQuery({
        ip: (_ip, w) => (w <= 60 * 60_000 ? 20 : 50),
        address: (_a, w) => (w <= 60 * 60_000 ? 4 : 10),
        uid: () => 15,
      }),
    });
    const result = await check.check({
      address: ADDR,
      ip: '10.0.0.1',
      requestedAt: Date.UTC(2024, 0, 1, 3, 0, 0),
      fingerprint: { confidence: 0.1 },
      hostContext: { uid: 'u1' },
    });
    const top = (result.signals as { top: unknown[] }).top;
    expect(Array.isArray(top)).toBe(true);
    expect(top.length).toBeGreaterThan(0);
    expect(top.length).toBeLessThanOrEqual(3);
  });
});
