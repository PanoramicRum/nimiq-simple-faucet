/**
 * Automatic reward calculation.
 *
 * In automatic mode the developer app does NOT choose or send the payout
 * amount — the faucet derives it from operator config:
 *
 *   finalAmount = baselineAmount + Σ adjustments
 *
 * Phase 1 was the trivial case (`adjustments: []`). Phase 2 adds the first
 * adjustment rule — **low-balance scaling**: when the wallet balance is below a
 * configured threshold, the reward is reduced by a flat percentage. Further
 * phases plug in additively by pushing more {@link RewardAdjustment}s and
 * recomputing `amount`, with no claim-handler surgery.
 *
 * Units: every amount here is in **Luna** (the smallest Nimiq unit, 1 NIM =
 * 100_000 Luna), matching the rest of the server. Operator config is expressed
 * in NIM for readability and converted at the boundary via {@link nimToLuna}.
 */

export type RewardMode = 'automatic';

/** A single reward adjustment applied on top of the baseline. */
export interface RewardAdjustment {
  /** Stable identifier for the rule that fired, e.g. `low-balance-scaling`. */
  kind: string;
  /** Signed delta applied to the running amount, in Luna (negative = reduction). */
  deltaLuna: bigint;
  /** Human-readable reason, for audit/logging. */
  reason?: string;
}

export interface RewardResult {
  /** Final amount to send, in Luna (`baselineAmount` + Σ adjustment deltas). */
  amount: bigint;
  rewardMode: RewardMode;
  /** Configured baseline, in Luna (before adjustments). */
  baselineAmount: bigint;
  /** Applied adjustments (empty when nothing modified the baseline). */
  adjustments: RewardAdjustment[];
}

const LUNA_PER_NIM = 100_000;
/** Percent → basis points (×100), so a fractional percent stays exact in bigint math. */
const BASIS_POINTS = 10_000n;
/** Defensive ceiling on the first-time boost (also enforced by Zod + the admin API). */
const MAX_FIRST_TIME_BOOST_PERCENT = 500;
/** Defensive ceiling on the whitelist bonus percent (also enforced by Zod + the admin API). */
const MAX_WHITELIST_BONUS_PERCENT = 500;

/**
 * Convert an operator-supplied NIM amount to Luna (bigint).
 *
 * Returns `0n` for any missing/invalid input (undefined, NaN, ≤ 0) so the
 * function is total — the caller is responsible for treating a non-positive
 * result as "no valid value". This keeps a misconfiguration from throwing deep
 * in the request path.
 */
export function nimToLuna(nim: number | undefined): bigint {
  if (nim === undefined || !Number.isFinite(nim) || nim <= 0) return 0n;
  return BigInt(Math.round(nim * LUNA_PER_NIM));
}

/** Inputs to {@link calculateAutomaticReward}. All optional; the function is total. */
export interface RewardInput {
  /** Baseline reward, in NIM. */
  baselineNim?: number | undefined;
  /** Low-balance threshold, in NIM. Scaling fires only when balance < this. */
  lowBalanceThresholdNim?: number | undefined;
  /** Flat reduction percent (0–100) applied below the threshold. */
  lowBalanceReductionPercent?: number | undefined;
  /** Whether this claimant qualifies for the first-time boost (caller decides). */
  isFirstTime?: boolean | undefined;
  /** First-time boost percent (0–500); applies only when not in a low-balance state. */
  firstTimeBoostPercent?: number | undefined;
  /**
   * Effective repeat-user reduction percent (0–100), already resolved by the
   * handler from claim counts + tiers (largest triggered tier wins). A negative
   * adjustment applied **regardless of balance state**; mutually exclusive with
   * the first-time boost (a repeat reduction suppresses the boost).
   */
  repeatReductionPercent?: number | undefined;
  /**
   * Winning reward-whitelist entry for this claimant (caller resolves via
   * `findWhitelistMatch`), or `null`/`undefined` when not listed. An entry's
   * `exactAmountNim` replaces the whole computation; its `bonusPercent`
   * overrides the global {@link RewardInput.whitelistBonusPercent} default.
   */
  whitelist?: { bonusPercent: number | null; exactAmountNim: number | null } | null | undefined;
  /** Global whitelist bonus percent (0–500) for entries without their own. */
  whitelistBonusPercent?: number | undefined;
  /**
   * Current wallet balance in Luna, or `null`/`undefined` when unknown. When
   * unknown, low-balance scaling is skipped (never reduce on a stale/failed
   * balance read — that would silently halve every payout during an RPC blip),
   * and the first-time boost is suppressed (we can't confirm the wallet is healthy).
   */
  balanceLuna?: bigint | null | undefined;
}

/**
 * Compute the automatic reward. Pure and total — never throws. The final amount
 * is the baseline plus the sum of every applied adjustment delta, floored at 0.
 *
 * Three rules:
 *  - **Low-balance scaling** (negative) fires when a positive threshold is set,
 *    the balance is known, and `balance < threshold`. Basis-point bigint math
 *    truncates *down* (never over-pays); a reduction outside `(0, 100]` is
 *    ignored. A 100% reduction yields `amount: 0n` (caller refuses → pause).
 *  - **Repeat-user reduction** (negative) fires when a valid
 *    `repeatReductionPercent` in `(0, 100]` is supplied. It is **independent of
 *    balance state** and **stacks additively** with low-balance scaling — both
 *    deltas are measured against the baseline and summed (so a combined ≥ 100%
 *    floors to `0n` → caller refuses).
 *  - **First-time boost** (positive) fires when `isFirstTime`, a boost in
 *    `(0, 500]` is set, and the wallet is known to be at/above the threshold
 *    (or no threshold is configured). It is **suppressed while the wallet is low
 *    or its balance is unknown** — a low faucet must not hand out extra — and
 *    **suppressed whenever a repeat reduction fires** (boost ⊥ repeat).
 *  - **Whitelist bonus** (§2.4.5) fires for allow-listed identities. Two forms:
 *    an **exact amount** (`whitelist.exactAmountNim > 0`) replaces the whole
 *    computation — low-balance scaling included — because "exact" means exact
 *    (the claim handler's final exceeds-balance refusal still backstops the
 *    wallet); a **percent bonus** (per-entry `bonusPercent`, falling back to
 *    the global `whitelistBonusPercent`, in `(0, 500]`) is measured against
 *    the baseline and stacks with low-balance scaling. Either form
 *    **suppresses the first-time boost and the repeat reduction** — listed
 *    identities are trusted partners/CI, not farmable accounts. A listed
 *    identity whose entry grants nothing (no exact, no percent anywhere)
 *    leaves every other rule untouched. Invalid baseline (≤ 0) disables the
 *    whitelist like every other rule — a misconfigured faucet refuses.
 */
export function calculateAutomaticReward(input: RewardInput): RewardResult {
  const baseline = nimToLuna(input.baselineNim);
  const adjustments: RewardAdjustment[] = [];

  const thresholdLuna = nimToLuna(input.lowBalanceThresholdNim);
  const balanceKnown = input.balanceLuna !== undefined && input.balanceLuna !== null;
  // "Low-balance state" = a threshold is configured and we're confident the
  // wallet is below it. When a threshold is set but the balance can't be read,
  // we treat the state as uncertain: skip the reduction AND suppress the boost.
  const lowBalanceConfigured = thresholdLuna > 0n;
  const walletIsLow = lowBalanceConfigured && balanceKnown && (input.balanceLuna as bigint) < thresholdLuna;
  const lowBalanceUncertain = lowBalanceConfigured && !balanceKnown;

  // Repeat-user reduction is active when a valid percent is supplied. Computed
  // up front so it can both push its adjustment and suppress the first-time boost.
  const repeatReduction = input.repeatReductionPercent;
  const repeatReductionActive =
    repeatReduction !== undefined &&
    Number.isFinite(repeatReduction) &&
    repeatReduction > 0 &&
    repeatReduction <= 100;

  // Whitelist bonus (§2.4.5) — computed up front because it suppresses the
  // first-time boost and the repeat reduction, and its exact-amount form also
  // suppresses low-balance scaling. "Active" means the entry actually grants
  // something: an exact amount, or a percent that survives rounding to basis
  // points — a listed identity granting nothing changes no other rule.
  const wl = input.whitelist ?? null;
  const wlExactLuna = wl ? nimToLuna(wl.exactAmountNim ?? undefined) : 0n;
  const wlExactActive = baseline > 0n && wlExactLuna > 0n;
  const wlPercent = wl ? (wl.bonusPercent ?? input.whitelistBonusPercent) : undefined;
  const wlPercentBp =
    wlPercent !== undefined &&
    Number.isFinite(wlPercent) &&
    wlPercent > 0 &&
    wlPercent <= MAX_WHITELIST_BONUS_PERCENT
      ? BigInt(Math.round(wlPercent * 100))
      : 0n;
  const wlPercentActive = !wlExactActive && baseline > 0n && wl !== null && wlPercentBp > 0n;
  const whitelistActive = wlExactActive || wlPercentActive;

  // Low-balance reduction (negative delta) — only while the wallet is low.
  // An exact-amount whitelist entry replaces the whole computation, scaling
  // included ("exact" means exact; the handler's exceeds-balance refusal is
  // the wallet backstop).
  if (baseline > 0n && walletIsLow && !wlExactActive) {
    const reduction = input.lowBalanceReductionPercent;
    const reductionValid =
      reduction !== undefined && Number.isFinite(reduction) && reduction > 0 && reduction <= 100;
    if (reductionValid) {
      const reductionBp = BigInt(Math.round(reduction * 100));
      const reduced = (baseline * (BASIS_POINTS - reductionBp)) / BASIS_POINTS;
      if (reduced !== baseline) {
        adjustments.push({
          kind: 'low-balance-scaling',
          deltaLuna: reduced - baseline,
          reason: `wallet balance below ${input.lowBalanceThresholdNim} NIM; reward reduced ${reduction}%`,
        });
      }
    }
  }

  // Repeat-user reduction (negative delta) — independent of balance state.
  // Measured against the baseline (like low-balance scaling), so the two
  // reductions stack additively in the accumulator below. Suppressed for
  // allow-listed identities (whitelist ⊥ repeat — a listed partner/CI wallet
  // is expected to claim repeatedly).
  if (baseline > 0n && repeatReductionActive && !whitelistActive) {
    // repeatReductionActive aliases `repeatReduction !== undefined && …`, so TS
    // narrows repeatReduction to number here — no cast needed.
    const reductionBp = BigInt(Math.round(repeatReduction * 100));
    const reduced = (baseline * (BASIS_POINTS - reductionBp)) / BASIS_POINTS;
    if (reduced !== baseline) {
      adjustments.push({
        kind: 'repeat-user-reduction',
        deltaLuna: reduced - baseline,
        reason: `repeat claimant; reward reduced ${repeatReduction}%`,
      });
    }
  }

  // First-time boost (positive delta) — only when the wallet is confidently NOT
  // low and no repeat reduction is in effect (boost ⊥ repeat). Also suppressed
  // for allow-listed identities (the whitelist bonus wins; they don't stack).
  if (
    baseline > 0n &&
    input.isFirstTime &&
    !walletIsLow &&
    !lowBalanceUncertain &&
    !repeatReductionActive &&
    !whitelistActive
  ) {
    const boost = input.firstTimeBoostPercent;
    const boostValid =
      boost !== undefined && Number.isFinite(boost) && boost > 0 && boost <= MAX_FIRST_TIME_BOOST_PERCENT;
    if (boostValid) {
      const boostBp = BigInt(Math.round(boost * 100));
      const boosted = (baseline * (BASIS_POINTS + boostBp)) / BASIS_POINTS;
      if (boosted !== baseline) {
        adjustments.push({
          kind: 'first-time-boost',
          deltaLuna: boosted - baseline,
          reason: `first-time claimant; reward boosted ${boost}%`,
        });
      }
    }
  }

  // Whitelist bonus (§2.4.5). Exact form: delta lands the amount exactly on
  // the entry's NIM value (may be below the baseline — "exact" means exact);
  // a delta of 0n (exact == baseline) pushes nothing but the suppressions
  // above still hold. Percent form: measured against the baseline like every
  // other percentage rule, so it stacks additively with low-balance scaling.
  if (wlExactActive) {
    if (wlExactLuna !== baseline) {
      adjustments.push({
        kind: 'whitelist-bonus',
        deltaLuna: wlExactLuna - baseline,
        reason: `allow-listed identity; exact payout ${wl?.exactAmountNim} NIM`,
      });
    }
  } else if (wlPercentActive) {
    const boosted = (baseline * (BASIS_POINTS + wlPercentBp)) / BASIS_POINTS;
    if (boosted !== baseline) {
      adjustments.push({
        kind: 'whitelist-bonus',
        deltaLuna: boosted - baseline,
        reason: `allow-listed identity; reward boosted ${wlPercent}%`,
      });
    }
  }

  let amount = baseline;
  for (const adj of adjustments) amount += adj.deltaLuna;
  if (amount < 0n) amount = 0n;

  return { amount, rewardMode: 'automatic', baselineAmount: baseline, adjustments };
}

/** Minimal slice of `ServerConfig` the payout/settings resolvers need. */
export interface PayoutConfig {
  automaticRewardsEnabled: boolean;
  automaticRewardsBaselineNim?: number | undefined;
  lowBalanceThresholdNim?: number | undefined;
  lowBalanceReductionPercent?: number | undefined;
  firstTimeBoostPercent?: number | undefined;
  firstTimeBoostUseFingerprint?: boolean | undefined;
  firstTimeBoostUseUid?: boolean | undefined;
  repeatReductionDailyThreshold?: number | undefined;
  repeatReductionDailyPercent?: number | undefined;
  repeatReductionWeeklyThreshold?: number | undefined;
  repeatReductionWeeklyPercent?: number | undefined;
  repeatReductionMonthlyThreshold?: number | undefined;
  repeatReductionMonthlyPercent?: number | undefined;
  repeatReductionUseAddress?: boolean | undefined;
  repeatReductionUseIp?: boolean | undefined;
  repeatReductionUseFingerprint?: boolean | undefined;
  whitelistRewardsEnabled?: boolean | undefined;
  whitelistBonusPercent?: number | undefined;
  claimAmountLuna: bigint;
}

export interface ResolvedPayout {
  /** Amount (Luna) the handler should send and record. */
  amountLuna: bigint;
  /** Reward metadata when automatic mode is on; `null` for the explicit flow. */
  reward: RewardResult | null;
}

/**
 * Single seam between config and the claim handler for the **baseline** payout
 * (no balance context). Used for the public `/v1/config` display amount and for
 * deny/challenge claim records, which never pay out. Low-balance scaling is
 * applied separately in the claim handler once the balance is known.
 */
export function resolvePayout(config: PayoutConfig): ResolvedPayout {
  if (config.automaticRewardsEnabled) {
    const reward = calculateAutomaticReward({ baselineNim: config.automaticRewardsBaselineNim });
    return { amountLuna: reward.amount, reward };
  }
  return { amountLuna: config.claimAmountLuna, reward: null };
}

/** Effective reward settings after merging persisted admin overrides over env defaults. */
export interface EffectiveRewardSettings {
  enabled: boolean;
  baselineNim?: number | undefined;
  lowBalanceThresholdNim?: number | undefined;
  lowBalanceReductionPercent?: number | undefined;
  firstTimeBoostPercent?: number | undefined;
  firstTimeBoostUseFingerprint: boolean;
  firstTimeBoostUseUid: boolean;
  repeatReductionDailyThreshold?: number | undefined;
  repeatReductionDailyPercent?: number | undefined;
  repeatReductionWeeklyThreshold?: number | undefined;
  repeatReductionWeeklyPercent?: number | undefined;
  repeatReductionMonthlyThreshold?: number | undefined;
  repeatReductionMonthlyPercent?: number | undefined;
  repeatReductionUseAddress: boolean;
  repeatReductionUseIp: boolean;
  repeatReductionUseFingerprint: boolean;
  whitelistRewardsEnabled: boolean;
  whitelistBonusPercent?: number | undefined;
}

function pickInRange(
  override: unknown,
  envDefault: number | undefined,
  min: number,
  max: number,
): number | undefined {
  if (typeof override === 'number' && Number.isFinite(override) && override >= min && override <= max) {
    return override;
  }
  // Malformed / out-of-range persisted override → fall back to the env default.
  return envDefault;
}

function pickBool(override: unknown, envDefault: boolean): boolean {
  return typeof override === 'boolean' ? override : envDefault;
}

/**
 * Merge persisted runtime overrides over env-derived config to produce the
 * effective reward settings used at claim time. The low-balance, first-time, and
 * repeat-user-reduction keys are read live (override-wins); a malformed/out-of-range
 * `runtime_config` row falls back to the env default so it can never widen
 * behaviour unexpectedly. `enabled` and `baselineNim` stay env-only.
 */
export function resolveRewardSettings(
  config: PayoutConfig,
  overrides: Record<string, unknown>,
): EffectiveRewardSettings {
  return {
    enabled: config.automaticRewardsEnabled,
    baselineNim: config.automaticRewardsBaselineNim,
    lowBalanceThresholdNim: pickInRange(
      overrides.lowBalanceThresholdNim,
      config.lowBalanceThresholdNim,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    lowBalanceReductionPercent: pickInRange(
      overrides.lowBalanceReductionPercent,
      config.lowBalanceReductionPercent,
      0,
      100,
    ),
    firstTimeBoostPercent: pickInRange(
      overrides.firstTimeBoostPercent,
      config.firstTimeBoostPercent,
      0,
      MAX_FIRST_TIME_BOOST_PERCENT,
    ),
    firstTimeBoostUseFingerprint: pickBool(
      overrides.firstTimeBoostUseFingerprint,
      config.firstTimeBoostUseFingerprint ?? false,
    ),
    firstTimeBoostUseUid: pickBool(
      overrides.firstTimeBoostUseUid,
      config.firstTimeBoostUseUid ?? false,
    ),
    repeatReductionDailyThreshold: pickInRange(
      overrides.repeatReductionDailyThreshold,
      config.repeatReductionDailyThreshold,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    repeatReductionDailyPercent: pickInRange(
      overrides.repeatReductionDailyPercent,
      config.repeatReductionDailyPercent,
      0,
      100,
    ),
    repeatReductionWeeklyThreshold: pickInRange(
      overrides.repeatReductionWeeklyThreshold,
      config.repeatReductionWeeklyThreshold,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    repeatReductionWeeklyPercent: pickInRange(
      overrides.repeatReductionWeeklyPercent,
      config.repeatReductionWeeklyPercent,
      0,
      100,
    ),
    repeatReductionMonthlyThreshold: pickInRange(
      overrides.repeatReductionMonthlyThreshold,
      config.repeatReductionMonthlyThreshold,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    repeatReductionMonthlyPercent: pickInRange(
      overrides.repeatReductionMonthlyPercent,
      config.repeatReductionMonthlyPercent,
      0,
      100,
    ),
    repeatReductionUseAddress: pickBool(
      overrides.repeatReductionUseAddress,
      config.repeatReductionUseAddress ?? true,
    ),
    repeatReductionUseIp: pickBool(
      overrides.repeatReductionUseIp,
      config.repeatReductionUseIp ?? false,
    ),
    repeatReductionUseFingerprint: pickBool(
      overrides.repeatReductionUseFingerprint,
      config.repeatReductionUseFingerprint ?? false,
    ),
    whitelistRewardsEnabled: pickBool(
      overrides.whitelistRewardsEnabled,
      config.whitelistRewardsEnabled ?? false,
    ),
    whitelistBonusPercent: pickInRange(
      overrides.whitelistBonusPercent,
      config.whitelistBonusPercent,
      0,
      MAX_WHITELIST_BONUS_PERCENT,
    ),
  };
}
