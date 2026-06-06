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
 * Two rules, mutually exclusive by balance state:
 *  - **Low-balance scaling** (negative) fires when a positive threshold is set,
 *    the balance is known, and `balance < threshold`. Basis-point bigint math
 *    truncates *down* (never over-pays); a reduction outside `(0, 100]` is
 *    ignored. A 100% reduction yields `amount: 0n` (caller refuses → pause).
 *  - **First-time boost** (positive) fires when `isFirstTime`, a boost in
 *    `(0, 500]` is set, and the wallet is known to be at/above the threshold
 *    (or no threshold is configured). It is **suppressed while the wallet is low
 *    or its balance is unknown** — a low faucet must not hand out extra.
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

  // Low-balance reduction (negative delta) — only while the wallet is low.
  if (baseline > 0n && walletIsLow) {
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

  // First-time boost (positive delta) — only when the wallet is confidently NOT
  // low (mutually exclusive with the reduction above).
  if (baseline > 0n && input.isFirstTime && !walletIsLow && !lowBalanceUncertain) {
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
 * effective reward settings used at claim time. The low-balance + first-time
 * keys are read live (override-wins); a malformed/out-of-range `runtime_config`
 * row falls back to the env default so it can never widen behaviour unexpectedly.
 * `enabled` and `baselineNim` stay env-only.
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
  };
}
