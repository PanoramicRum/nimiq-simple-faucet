import { describe, expect, it } from 'vitest';
import {
  mintChallenge,
  hashcashCheck,
  solveChallenge,
  MemoryHashcashReplayStore,
} from '../src/index.js';

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

  it('rejects a replayed solution within the TTL (#95)', async () => {
    // Same check instance shares one in-memory replay store across calls
    // — that's the production wiring: one buildPipeline → one hashcashCheck
    // → one MemoryHashcashReplayStore.
    const ip = '10.0.0.1';
    const now = Date.now();
    const { challenge, difficulty } = mintChallenge(cfg, { ip }, now);
    const nonce = await solveChallenge(challenge, difficulty);
    const check = hashcashCheck(cfg);
    const req = {
      address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
      ip,
      requestedAt: now,
      hashcashSolution: `${challenge}#${nonce}`,
    };

    const first = await check.check(req);
    expect(first.score).toBe(0);
    expect(first.decision).toBeUndefined();

    const replay = await check.check(req);
    expect(replay.decision).toBe('deny');
    expect(replay.reason).toBe('hashcash replayed');
    expect(replay.signals).toMatchObject({ replayed: true });
  });

  it('lets the same nonce land on two distinct challenges (independent puzzles)', async () => {
    // Two challenges minted at different times → distinct keys; the same
    // nonce string (vanishingly unlikely in practice but trivial here)
    // must not be flagged as a replay because the (challenge, nonce)
    // pair is what we de-duplicate, not just the nonce.
    const ip = '10.0.0.1';
    const c1 = mintChallenge(cfg, { ip }, Date.now() - 1000);
    const n1 = await solveChallenge(c1.challenge, c1.difficulty);
    const c2 = mintChallenge(cfg, { ip }, Date.now());
    const n2 = await solveChallenge(c2.challenge, c2.difficulty);

    const check = hashcashCheck(cfg);
    const r1 = await check.check({
      address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
      ip,
      requestedAt: Date.now(),
      hashcashSolution: `${c1.challenge}#${n1}`,
    });
    const r2 = await check.check({
      address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
      ip,
      requestedAt: Date.now(),
      hashcashSolution: `${c2.challenge}#${n2}`,
    });
    expect(r1.score).toBe(0);
    expect(r2.score).toBe(0);
  });

  it('honours an injected replay store (Redis substitution path)', async () => {
    // Operators with multiple replicas inject a shared store; we pin the
    // contract by injecting a custom store and confirming both the
    // accept and reject paths route through it.
    const calls: Array<{ key: string; expiresAt: number }> = [];
    const stub = {
      markSeen: (key: string, expiresAt: number) => {
        calls.push({ key, expiresAt });
        // Reject the second call regardless of key.
        return calls.length === 1;
      },
    };
    const ip = '10.0.0.1';
    const now = Date.now();
    const { challenge, difficulty } = mintChallenge(cfg, { ip }, now);
    const nonce = await solveChallenge(challenge, difficulty);
    const check = hashcashCheck({ ...cfg, replayStore: stub });
    const req = {
      address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
      ip,
      requestedAt: now,
      hashcashSolution: `${challenge}#${nonce}`,
    };

    const ok = await check.check(req);
    const rejected = await check.check(req);
    expect(ok.score).toBe(0);
    expect(rejected.decision).toBe('deny');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.key).toMatch(/^[0-9a-f]{16}:/);
  });
});

describe('MemoryHashcashReplayStore', () => {
  it('accepts a key once, rejects subsequent live submissions', () => {
    const s = new MemoryHashcashReplayStore();
    const now = 1_000;
    expect(s.markSeen('k', now + 5000, now)).toBe(true);
    expect(s.markSeen('k', now + 5000, now + 1)).toBe(false);
  });

  it('forgets keys past their expiry (no false positives after TTL)', () => {
    const s = new MemoryHashcashReplayStore();
    const now = 1_000;
    s.markSeen('k', now + 100, now);
    expect(s.markSeen('k', now + 5000, now + 200)).toBe(true);
  });
});
