import { describe, expect, it } from 'vitest';
import { AbusePipeline, type AbuseCheck, type ClaimRequest } from '../src/index.js';

function makeRequest(overrides: Partial<ClaimRequest> = {}): ClaimRequest {
  return {
    address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
    ip: '127.0.0.1',
    requestedAt: 1_700_000_000_000,
    ...overrides,
  };
}

const alwaysClean: AbuseCheck = {
  id: 'clean',
  async check() {
    return { score: 0, signals: {} };
  },
};

const warn: AbuseCheck = {
  id: 'warn',
  weight: 1,
  async check() {
    return { score: 0.5, signals: { note: 'meh' } };
  },
};

const hardDeny: AbuseCheck = {
  id: 'hard',
  async check() {
    return { score: 1, decision: 'deny', reason: 'blocked', signals: { who: 'bot' } };
  },
};

describe('AbusePipeline', () => {
  it('allows clean traffic', async () => {
    const p = new AbusePipeline([alwaysClean, alwaysClean]);
    const r = await p.evaluate(makeRequest());
    expect(r.decision).toBe('allow');
    expect(r.score).toBe(0);
    expect(r.perCheck).toHaveLength(2);
  });

  it('escalates to challenge between thresholds', async () => {
    const p = new AbusePipeline([warn]);
    const r = await p.evaluate(makeRequest());
    expect(r.decision).toBe('challenge');
    expect(r.score).toBeCloseTo(0.5, 5);
  });

  it('short-circuits on a hard deny', async () => {
    const p = new AbusePipeline([hardDeny, alwaysClean]);
    const r = await p.evaluate(makeRequest());
    expect(r.decision).toBe('deny');
    expect(r.perCheck).toHaveLength(1);
    expect(r.reasons[0]).toContain('blocked');
  });

  it('respects per-check weight in the aggregate', async () => {
    const heavyWarn: AbuseCheck = { ...warn, weight: 10 };
    const pHeavy = new AbusePipeline([heavyWarn, alwaysClean]);
    const pLight = new AbusePipeline([warn, alwaysClean]);
    const rHeavy = await pHeavy.evaluate(makeRequest());
    const rLight = await pLight.evaluate(makeRequest());
    expect(rHeavy.score).toBeGreaterThan(rLight.score);
  });

  it('treats a thrown check as a hard deny (#91 error boundary)', async () => {
    // A check that throws (e.g. captcha provider timeout) must not 500 the
    // pipeline. The boundary records it as deny so the calling route runs
    // its normal cleanup (decrement counter, write rejection row) instead
    // of leaking the exception out.
    const exploder: AbuseCheck = {
      id: 'flaky-provider',
      async check() {
        throw new Error('upstream timeout');
      },
    };
    const p = new AbusePipeline([alwaysClean, exploder, alwaysClean]);
    const r = await p.evaluate(makeRequest());
    expect(r.decision).toBe('deny');
    expect(r.perCheck.find((c) => c.id === 'flaky-provider')).toMatchObject({
      score: 1,
      decision: 'deny',
      signals: { error: 'upstream timeout' },
    });
    expect(r.reasons.some((s) => s.startsWith('flaky-provider'))).toBe(true);
    // Short-circuits — the trailing clean check should not have run.
    expect(r.perCheck.map((c) => c.id)).toEqual(['clean', 'flaky-provider']);
  });
});
