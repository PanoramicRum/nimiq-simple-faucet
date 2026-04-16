import { describe, expect, it } from 'vitest';
import type { ClaimRequest } from '@faucet/core';
import { fingerprintCheck, InMemoryFingerprintStore } from '../src/index.js';
import type { FingerprintStore } from '../src/index.js';

const ADDRESS = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';

function claim(overrides: Partial<ClaimRequest> = {}): ClaimRequest {
  return {
    address: ADDRESS,
    ip: '10.0.0.1',
    requestedAt: Date.now(),
    ...overrides,
  };
}

describe('abuse-fingerprint', () => {
  it('soft-skips when neither visitorId nor uid present', async () => {
    const check = fingerprintCheck({ store: new InMemoryFingerprintStore() });
    const result = await check.check(claim());
    expect(result.score).toBe(0);
    expect(result.signals).toEqual({ skipped: 'no-signals' });
    expect(result.decision).toBeUndefined();
  });

  it('first claim with both signals has score 0 and no decision (signed context)', async () => {
    const check = fingerprintCheck({ store: new InMemoryFingerprintStore() });
    const result = await check.check(
      claim({
        fingerprint: { visitorId: 'v1' },
        hostContext: { uid: 'u1' },
        hostContextVerified: true,
      }),
    );
    expect(result.score).toBe(0);
    expect(result.decision).toBeUndefined();
    expect(result.signals.visitorCount).toBe(1);
    expect(result.signals.uidCount).toBe(1);
  });

  it('signed host context does not add unsigned penalty', async () => {
    const check = fingerprintCheck({ store: new InMemoryFingerprintStore() });
    const result = await check.check(
      claim({
        fingerprint: { visitorId: 'v1' },
        hostContext: { uid: 'u1' },
        hostContextVerified: true,
      }),
    );
    expect(result.score).toBe(0);
    expect(result.signals.contextVerified).toBeUndefined();
  });

  it('unsigned host context adds the penalty', async () => {
    const check = fingerprintCheck({
      store: new InMemoryFingerprintStore(),
      unsignedContextPenalty: 0.3,
    });
    const result = await check.check(
      claim({
        fingerprint: { visitorId: 'v1' },
        hostContext: { uid: 'u1' },
        hostContextVerified: false,
      }),
    );
    expect(result.score).toBe(0.3);
    expect(result.signals.contextVerified).toBe(false);
  });

  it('escalates to review when one uid is seen with too many visitor IDs', async () => {
    const store = new InMemoryFingerprintStore();
    const check = fingerprintCheck({ store, maxVisitorsPerUid: 3 });
    let result;
    for (const v of ['v1', 'v2', 'v3', 'v4']) {
      result = await check.check(
        claim({
          fingerprint: { visitorId: v },
          hostContext: { uid: 'u1' },
          hostContextVerified: true,
        }),
      );
    }
    expect(result!.decision).toBe('review');
    expect(result!.score).toBeGreaterThanOrEqual(0.75);
    expect(result!.reason).toMatch(/4 distinct visitor IDs/);
  });

  it('denies when one visitor is associated with too many uids', async () => {
    const store = new InMemoryFingerprintStore();
    const check = fingerprintCheck({ store, maxUidsPerVisitor: 3 });
    let result;
    for (const u of ['u1', 'u2', 'u3', 'u4']) {
      result = await check.check(
        claim({
          fingerprint: { visitorId: 'v1' },
          hostContext: { uid: u },
          hostContextVerified: true,
        }),
      );
    }
    expect(result!.decision).toBe('deny');
    expect(result!.score).toBe(1);
    expect(result!.reason).toMatch(/4 distinct uids/);
  });

  it('soft-skips when store.record throws', async () => {
    const brokenStore: FingerprintStore = {
      async record() {
        throw new Error('db down');
      },
      async countVisitorsForUid() {
        return 0;
      },
      async countUidsForVisitor() {
        return 0;
      },
    };
    const check = fingerprintCheck({ store: brokenStore });
    const result = await check.check(
      claim({
        fingerprint: { visitorId: 'v1' },
        hostContext: { uid: 'u1' },
        hostContextVerified: true,
      }),
    );
    expect(result.score).toBe(0);
    expect(result.reason).toMatch(/soft-skip/);
  });
});
