import { describe, expect, it } from 'vitest';
import { mintChallenge, hashcashCheck, solveChallenge } from '../src/index.js';

const cfg = { secret: 'unit-test-secret', difficulty: 8, ttlMs: 60_000 } as const;

describe('abuse-hashcash', () => {
  it('accepts a correctly-solved challenge', async () => {
    const ip = '10.0.0.1';
    const { challenge, difficulty } = mintChallenge(cfg, { ip }, Date.now());
    const nonce = await solveChallenge(challenge, difficulty);
    const check = hashcashCheck(cfg);
    const result = await check.check({
      address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
      ip,
      requestedAt: Date.now(),
      hashcashSolution: `${challenge}#${nonce}`,
    });
    expect(result.decision).toBeUndefined();
    expect(result.score).toBe(0);
  });

  it('denies a tampered challenge', async () => {
    const { challenge, difficulty } = mintChallenge(cfg, { ip: '10.0.0.1' }, Date.now());
    const nonce = await solveChallenge(challenge, difficulty);
    const forged = challenge.replace('10.0.0.1', '10.0.0.2');
    const check = hashcashCheck(cfg);
    const result = await check.check({
      address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
      ip: '10.0.0.1',
      requestedAt: Date.now(),
      hashcashSolution: `${forged}#${nonce}`,
    });
    expect(result.decision).toBe('deny');
  });

  it('challenges when no solution is provided', async () => {
    const check = hashcashCheck(cfg);
    const result = await check.check({
      address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
      ip: '10.0.0.1',
      requestedAt: Date.now(),
    });
    expect(result.decision).toBe('challenge');
  });
});
