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
  /**
   * Current wallet balance in Luna, or `null`/`undefined` when unknown. When
   * unknown, low-balance scaling is skipped (never reduce on a stale/failed
   * balance read — that would silently halve every payout during an RPC blip).
   */
  balanceLuna?: bigint | null | undefined;
}

/**
 * Compute the automatic reward. Pure and total — never throws.
 *
 * Low-balance scaling fires only when ALL hold: a positive baseline, a positive
 * threshold, a reduction in `(0, 100]`, a known balance, and `balance <
 * threshold`. The reduction uses basis-point bigint math (truncates *down*, so
 * it never over-pays). A reduction outside `(0, 100]` is ignored defensively, so
 * a bad config can never produce `amount > baseline`.
 *
 * A 100% reduction yields `amount: 0n`; the caller refuses such a claim opaquely
 * (pausing payouts while the wallet is critically low) rather than sending 0.
 */
export function calculateAutomaticReward(input: RewardInput): RewardResult {
  const baseline = nimToLuna(input.baselineNim);
  const adjustments: RewardAdjustment[] = [];
  let amount = baseline;

  const thresholdLuna = nimToLuna(input.lowBalanceThresholdNim);
  const reduction = input.lowBalanceReductionPercent;
  const reductionValid =
    reduction !== undefined && Number.isFinite(reduction) && reduction > 0 && reduction <= 100;

  if (
    baseline > 0n &&
    thresholdLuna > 0n &&
    reductionValid &&
    input.balanceLuna !== undefined &&
    input.balanceLuna !== null &&
    input.balanceLuna < thresholdLuna
  ) {
    const reductionBp = BigInt(Math.round((reduction as number) * 100));
    const reduced = (baseline * (BASIS_POINTS - reductionBp)) / BASIS_POINTS;
    if (reduced !== baseline) {
      adjustments.push({
        kind: 'low-balance-scaling',
        deltaLuna: reduced - baseline,
        reason: `wallet balance below ${input.lowBalanceThresholdNim} NIM; reward reduced ${reduction}%`,
      });
      amount = reduced;
    }
  }

  return { amount, rewardMode: 'automatic', baselineAmount: baseline, adjustments };
}

/** Minimal slice of `ServerConfig` the payout/settings resolvers need. */
export interface PayoutConfig {
  automaticRewardsEnabled: boolean;
  automaticRewardsBaselineNim?: number | undefined;
  lowBalanceThresholdNim?: number | undefined;
  lowBalanceReductionPercent?: number | undefined;
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

/**
 * Merge persisted runtime overrides over env-derived config to produce the
 * effective reward settings used at claim time. Only the two low-balance keys
 * are read live (override-wins); a malformed/out-of-range `runtime_config` row
 * falls back to the env default so it can never widen behaviour unexpectedly.
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
  };
}
