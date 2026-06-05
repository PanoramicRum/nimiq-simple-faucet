import { describe, expect, it } from 'vitest';
import { calculateAutomaticReward, nimToLuna, resolvePayout } from './automatic.js';

describe('nimToLuna', () => {
  it('converts NIM to luna (1 NIM = 100_000 luna)', () => {
    expect(nimToLuna(10)).toBe(1_000_000n);
    expect(nimToLuna(1)).toBe(100_000n);
    expect(nimToLuna(0.5)).toBe(50_000n);
  });

  it('returns 0n for missing / invalid / non-positive input', () => {
    expect(nimToLuna(undefined)).toBe(0n);
    expect(nimToLuna(0)).toBe(0n);
    expect(nimToLuna(-5)).toBe(0n);
    expect(nimToLuna(Number.NaN)).toBe(0n);
    expect(nimToLuna(Number.POSITIVE_INFINITY)).toBe(0n);
  });
});

describe('calculateAutomaticReward', () => {
  // Test #2 / #8: automatic mode uses the baseline and returns no adjustments.
  it('returns finalAmount == baseline (in luna) with rewardMode "automatic" and adjustments []', () => {
    const reward = calculateAutomaticReward({ baselineNim: 10 });
    expect(reward).toEqual({
      amount: 1_000_000n,
      rewardMode: 'automatic',
      baselineAmount: 1_000_000n,
      adjustments: [],
    });
  });

  it('always returns adjustments: [] in Phase 1', () => {
    expect(calculateAutomaticReward({ baselineNim: 1 }).adjustments).toEqual([]);
    expect(calculateAutomaticReward({ baselineNim: 0 }).adjustments).toEqual([]);
    expect(calculateAutomaticReward({}).adjustments).toEqual([]);
  });

  // Test #5 (unit half): an invalid baseline yields a non-positive amount the
  // caller refuses — the function itself never throws.
  it('yields amount 0n for missing/zero/negative baseline (caller decides validity)', () => {
    expect(calculateAutomaticReward({}).amount).toBe(0n);
    expect(calculateAutomaticReward({ baselineNim: 0 }).amount).toBe(0n);
    expect(calculateAutomaticReward({ baselineNim: -3 }).amount).toBe(0n);
  });
});

describe('resolvePayout', () => {
  const base = { claimAmountLuna: 100_000n };

  // Test #1 (unit half): automatic OFF → fixed claimAmountLuna, no reward meta.
  it('uses the fixed claimAmountLuna when automatic mode is off', () => {
    expect(resolvePayout({ ...base, automaticRewardsEnabled: false })).toEqual({
      amountLuna: 100_000n,
      reward: null,
    });
  });

  it('uses the automatic baseline when automatic mode is on', () => {
    const resolved = resolvePayout({
      ...base,
      automaticRewardsEnabled: true,
      automaticRewardsBaselineNim: 10,
    });
    expect(resolved.amountLuna).toBe(1_000_000n);
    expect(resolved.reward?.rewardMode).toBe('automatic');
  });

  it('surfaces an invalid automatic baseline as amountLuna 0n', () => {
    expect(
      resolvePayout({ ...base, automaticRewardsEnabled: true, automaticRewardsBaselineNim: 0 })
        .amountLuna,
    ).toBe(0n);
  });
});
