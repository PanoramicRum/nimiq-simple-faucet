import { describe, expect, it } from 'vitest';
import {
  calculateAutomaticReward,
  nimToLuna,
  resolvePayout,
  resolveRewardSettings,
} from './automatic.js';

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

describe('calculateAutomaticReward — low-balance scaling', () => {
  // baseline 10 NIM = 1_000_000 luna; threshold 5 NIM = 500_000 luna.
  const baseInput = { baselineNim: 10, lowBalanceThresholdNim: 5, lowBalanceReductionPercent: 25 };

  it('reduces the reward by the flat percent when balance is below the threshold', () => {
    const r = calculateAutomaticReward({ ...baseInput, balanceLuna: 400_000n });
    expect(r.amount).toBe(750_000n);
    expect(r.baselineAmount).toBe(1_000_000n);
    expect(r.adjustments).toEqual([
      {
        kind: 'low-balance-scaling',
        deltaLuna: -250_000n,
        reason: 'wallet balance below 5 NIM; reward reduced 25%',
      },
    ]);
  });

  it('pays the full baseline when balance is at or above the threshold', () => {
    expect(calculateAutomaticReward({ ...baseInput, balanceLuna: 600_000n }).amount).toBe(1_000_000n);
    // exactly at threshold (not strictly below) → no scaling
    const atThreshold = calculateAutomaticReward({ ...baseInput, balanceLuna: 500_000n });
    expect(atThreshold.amount).toBe(1_000_000n);
    expect(atThreshold.adjustments).toEqual([]);
  });

  it('does NOT scale when the balance is unknown (null/undefined) — RPC-failure safety', () => {
    expect(calculateAutomaticReward({ ...baseInput, balanceLuna: null }).amount).toBe(1_000_000n);
    expect(calculateAutomaticReward({ ...baseInput, balanceLuna: undefined }).amount).toBe(1_000_000n);
    expect(calculateAutomaticReward({ ...baseInput }).adjustments).toEqual([]);
  });

  it('0% reduction is a no-op', () => {
    const r = calculateAutomaticReward({
      baselineNim: 10,
      lowBalanceThresholdNim: 5,
      lowBalanceReductionPercent: 0,
      balanceLuna: 100_000n,
    });
    expect(r.amount).toBe(1_000_000n);
    expect(r.adjustments).toEqual([]);
  });

  it('100% reduction scales to zero (caller refuses) and records the adjustment', () => {
    const r = calculateAutomaticReward({
      baselineNim: 10,
      lowBalanceThresholdNim: 5,
      lowBalanceReductionPercent: 100,
      balanceLuna: 100_000n,
    });
    expect(r.amount).toBe(0n);
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0]?.deltaLuna).toBe(-1_000_000n);
  });

  it('ignores an out-of-range reduction (defensive) — never exceeds the baseline', () => {
    const over = calculateAutomaticReward({
      baselineNim: 10,
      lowBalanceThresholdNim: 5,
      lowBalanceReductionPercent: 150,
      balanceLuna: 100_000n,
    });
    expect(over.amount).toBe(1_000_000n);
    expect(over.adjustments).toEqual([]);
    const negative = calculateAutomaticReward({
      baselineNim: 10,
      lowBalanceThresholdNim: 5,
      lowBalanceReductionPercent: -10,
      balanceLuna: 100_000n,
    });
    expect(negative.amount).toBe(1_000_000n);
  });

  it('does not scale when the threshold is unset or zero', () => {
    expect(
      calculateAutomaticReward({ baselineNim: 10, lowBalanceReductionPercent: 25, balanceLuna: 1n })
        .amount,
    ).toBe(1_000_000n);
    expect(
      calculateAutomaticReward({
        baselineNim: 10,
        lowBalanceThresholdNim: 0,
        lowBalanceReductionPercent: 25,
        balanceLuna: 1n,
      }).amount,
    ).toBe(1_000_000n);
  });

  it('truncates the reduced payout DOWN (never over-pays) on fractional luna', () => {
    // baseline 1.00001 NIM = 100_001 luna; 1% reduction → 99_000.99 → 99_000n
    const r = calculateAutomaticReward({
      baselineNim: 1.00001,
      lowBalanceThresholdNim: 5,
      lowBalanceReductionPercent: 1,
      balanceLuna: 1n,
    });
    expect(r.baselineAmount).toBe(100_001n);
    expect(r.amount).toBe(99_000n);
    expect(r.amount).toBeLessThan(100_001n);
  });
});

describe('calculateAutomaticReward — first-time boost', () => {
  // baseline 10 NIM = 1_000_000 luna.
  it('boosts a first-time claimant when the wallet is not low (no threshold configured)', () => {
    const r = calculateAutomaticReward({ baselineNim: 10, firstTimeBoostPercent: 50, isFirstTime: true });
    expect(r.amount).toBe(1_500_000n);
    expect(r.adjustments).toEqual([
      { kind: 'first-time-boost', deltaLuna: 500_000n, reason: 'first-time claimant; reward boosted 50%' },
    ]);
  });

  it('boosts when first-time and balance is at/above the threshold', () => {
    const r = calculateAutomaticReward({
      baselineNim: 10,
      firstTimeBoostPercent: 50,
      isFirstTime: true,
      lowBalanceThresholdNim: 20,
      balanceLuna: 5_000_000n, // >= 20 NIM threshold
    });
    expect(r.amount).toBe(1_500_000n);
  });

  it('does not boost a returning claimant or when the boost is 0/undefined', () => {
    expect(calculateAutomaticReward({ baselineNim: 10, firstTimeBoostPercent: 50, isFirstTime: false }).amount).toBe(1_000_000n);
    expect(calculateAutomaticReward({ baselineNim: 10, firstTimeBoostPercent: 0, isFirstTime: true }).amount).toBe(1_000_000n);
    expect(calculateAutomaticReward({ baselineNim: 10, isFirstTime: true }).amount).toBe(1_000_000n);
  });

  // Key decision: the boost is suppressed while the wallet is low; the
  // low-balance pause is preserved even for first-time claimants.
  it('suppresses the boost while the wallet is below the threshold (only reduction applies)', () => {
    const r = calculateAutomaticReward({
      baselineNim: 10,
      firstTimeBoostPercent: 50,
      isFirstTime: true,
      lowBalanceThresholdNim: 20,
      lowBalanceReductionPercent: 25,
      balanceLuna: 1_000_000n, // < 20 NIM threshold
    });
    expect(r.amount).toBe(750_000n); // reduction only, NO boost
    expect(r.adjustments.map((a) => a.kind)).toEqual(['low-balance-scaling']);
  });

  it('a 100% reduction still pauses payouts for a first-timer (boost cannot rescue it)', () => {
    const r = calculateAutomaticReward({
      baselineNim: 10,
      firstTimeBoostPercent: 500,
      isFirstTime: true,
      lowBalanceThresholdNim: 20,
      lowBalanceReductionPercent: 100,
      balanceLuna: 1_000_000n,
    });
    expect(r.amount).toBe(0n);
  });

  it('suppresses the boost when a threshold is set but the balance is unknown', () => {
    const r = calculateAutomaticReward({
      baselineNim: 10,
      firstTimeBoostPercent: 50,
      isFirstTime: true,
      lowBalanceThresholdNim: 20,
      balanceLuna: null,
    });
    expect(r.amount).toBe(1_000_000n);
  });

  it('ignores an out-of-range boost (>500) defensively', () => {
    const r = calculateAutomaticReward({ baselineNim: 10, firstTimeBoostPercent: 600, isFirstTime: true });
    expect(r.amount).toBe(1_000_000n);
    expect(r.adjustments).toEqual([]);
  });
});

describe('calculateAutomaticReward — repeat-user reduction', () => {
  // baseline 10 NIM = 1_000_000 luna.
  it('reduces by the flat percent independent of balance state', () => {
    const r = calculateAutomaticReward({ baselineNim: 10, repeatReductionPercent: 40 });
    expect(r.amount).toBe(600_000n);
    expect(r.adjustments).toEqual([
      {
        kind: 'repeat-user-reduction',
        deltaLuna: -400_000n,
        reason: 'repeat claimant; reward reduced 40%',
      },
    ]);
  });

  it('applies even when the balance is unknown (unlike low-balance scaling)', () => {
    expect(
      calculateAutomaticReward({ baselineNim: 10, repeatReductionPercent: 40, balanceLuna: null }).amount,
    ).toBe(600_000n);
  });

  it('stacks additively with low-balance scaling (baseline − low% − repeat%)', () => {
    const r = calculateAutomaticReward({
      baselineNim: 10,
      lowBalanceThresholdNim: 20,
      lowBalanceReductionPercent: 25,
      repeatReductionPercent: 40,
      balanceLuna: 1_000_000n, // < 20 NIM threshold → low-balance active
    });
    // 1_000_000 − 250_000 (low) − 400_000 (repeat) = 350_000
    expect(r.amount).toBe(350_000n);
    expect(r.adjustments.map((a) => a.kind)).toEqual([
      'low-balance-scaling',
      'repeat-user-reduction',
    ]);
  });

  it('a combined reduction ≥ 100% floors to 0n (caller refuses)', () => {
    const r = calculateAutomaticReward({
      baselineNim: 10,
      lowBalanceThresholdNim: 20,
      lowBalanceReductionPercent: 60,
      repeatReductionPercent: 60,
      balanceLuna: 1_000_000n,
    });
    expect(r.amount).toBe(0n);
  });

  it('ignores an out-of-range or zero repeat percent (defensive)', () => {
    expect(calculateAutomaticReward({ baselineNim: 10, repeatReductionPercent: 0 }).amount).toBe(1_000_000n);
    expect(calculateAutomaticReward({ baselineNim: 10, repeatReductionPercent: 150 }).amount).toBe(1_000_000n);
    expect(calculateAutomaticReward({ baselineNim: 10, repeatReductionPercent: -5 }).adjustments).toEqual([]);
  });

  it('suppresses the first-time boost whenever a repeat reduction fires (boost ⊥ repeat)', () => {
    const r = calculateAutomaticReward({
      baselineNim: 10,
      firstTimeBoostPercent: 50,
      isFirstTime: true,
      repeatReductionPercent: 40,
    });
    expect(r.amount).toBe(600_000n); // reduction only, no boost
    expect(r.adjustments.map((a) => a.kind)).toEqual(['repeat-user-reduction']);
  });
});

describe('resolveRewardSettings', () => {
  const cfg = {
    automaticRewardsEnabled: true,
    automaticRewardsBaselineNim: 10,
    lowBalanceThresholdNim: 20,
    lowBalanceReductionPercent: 30,
    firstTimeBoostPercent: 40,
    firstTimeBoostUseFingerprint: false,
    firstTimeBoostUseUid: false,
    claimAmountLuna: 100_000n,
  };

  it('lets valid persisted overrides win over the env defaults', () => {
    const s = resolveRewardSettings(cfg, {
      lowBalanceThresholdNim: 5,
      lowBalanceReductionPercent: 60,
      firstTimeBoostPercent: 75,
      firstTimeBoostUseFingerprint: true,
      firstTimeBoostUseUid: true,
    });
    expect(s.lowBalanceThresholdNim).toBe(5);
    expect(s.lowBalanceReductionPercent).toBe(60);
    expect(s.firstTimeBoostPercent).toBe(75);
    expect(s.firstTimeBoostUseFingerprint).toBe(true);
    expect(s.firstTimeBoostUseUid).toBe(true);
    expect(s.enabled).toBe(true);
    expect(s.baselineNim).toBe(10);
  });

  it('falls back to the env default when an override is malformed / out of range', () => {
    const s = resolveRewardSettings(cfg, {
      lowBalanceThresholdNim: 'oops',
      lowBalanceReductionPercent: 150,
      firstTimeBoostPercent: 9999, // > 500
      firstTimeBoostUseFingerprint: 'yes', // not a boolean
    });
    expect(s.lowBalanceThresholdNim).toBe(20);
    expect(s.lowBalanceReductionPercent).toBe(30);
    expect(s.firstTimeBoostPercent).toBe(40);
    expect(s.firstTimeBoostUseFingerprint).toBe(false);
  });

  it('returns undefined/false when neither override nor env default is set', () => {
    const s = resolveRewardSettings(
      { automaticRewardsEnabled: false, claimAmountLuna: 100_000n },
      {},
    );
    expect(s.lowBalanceThresholdNim).toBeUndefined();
    expect(s.firstTimeBoostPercent).toBeUndefined();
    expect(s.firstTimeBoostUseFingerprint).toBe(false);
    expect(s.firstTimeBoostUseUid).toBe(false);
    // Repeat-reduction tiers default undefined; address defaults on, others off.
    expect(s.repeatReductionDailyThreshold).toBeUndefined();
    expect(s.repeatReductionDailyPercent).toBeUndefined();
    expect(s.repeatReductionWeeklyThreshold).toBeUndefined();
    expect(s.repeatReductionWeeklyPercent).toBeUndefined();
    expect(s.repeatReductionMonthlyThreshold).toBeUndefined();
    expect(s.repeatReductionMonthlyPercent).toBeUndefined();
    expect(s.repeatReductionUseAddress).toBe(true);
    expect(s.repeatReductionUseIp).toBe(false);
    expect(s.repeatReductionUseFingerprint).toBe(false);
  });

  it('resolves the repeat-reduction tiers + toggles (override wins; out-of-range falls back)', () => {
    const s = resolveRewardSettings(
      {
        ...cfg,
        repeatReductionDailyThreshold: 3,
        repeatReductionDailyPercent: 30,
        repeatReductionMonthlyThreshold: 20,
        repeatReductionMonthlyPercent: 70,
      },
      {
        repeatReductionDailyPercent: 55, // valid override wins
        repeatReductionWeeklyThreshold: 10, // override (no env default)
        repeatReductionWeeklyPercent: 200, // out of range → env default (undefined)
        repeatReductionMonthlyThreshold: 25, // override wins
        repeatReductionMonthlyPercent: 150, // out of range → env default (70)
        repeatReductionUseIp: true,
        repeatReductionUseFingerprint: true,
      },
    );
    expect(s.repeatReductionDailyThreshold).toBe(3); // env default kept (no override)
    expect(s.repeatReductionDailyPercent).toBe(55); // override wins
    expect(s.repeatReductionWeeklyThreshold).toBe(10);
    expect(s.repeatReductionWeeklyPercent).toBeUndefined(); // out of range → fallback
    expect(s.repeatReductionMonthlyThreshold).toBe(25); // override wins
    expect(s.repeatReductionMonthlyPercent).toBe(70); // out of range → env default
    expect(s.repeatReductionUseAddress).toBe(true); // default on
    expect(s.repeatReductionUseIp).toBe(true); // override
    expect(s.repeatReductionUseFingerprint).toBe(true); // override
  });
});
