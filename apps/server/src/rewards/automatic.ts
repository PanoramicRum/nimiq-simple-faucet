/**
 * Automatic reward calculation (Phase 1).
 *
 * In automatic mode the developer app does NOT choose or send the payout
 * amount — the faucet always derives it from operator config. Phase 1 is the
 * trivial case:
 *
 *   finalAmount = baselineAmount
 *
 * Future phases will populate `adjustments` (first-time boosts, repeat-user
 * reductions, low-balance scaling, whitelists/bonuses, …) and change how
 * `amount` is derived from the baseline. Everything here is deliberately small
 * and isolated so that growth is additive: a Phase-2 adjustment engine plugs in
 * by filling `adjustments` and recomputing `amount`, with no claim-handler
 * surgery.
 *
 * Units: every amount in this module is in **Luna** (the smallest Nimiq unit,
 * 1 NIM = 100_000 Luna), matching the rest of the server. Operator config is
 * expressed in NIM (`FAUCET_AUTOMATIC_REWARDS_BASELINE_NIM`) for readability and
 * converted to Luna at the boundary via {@link nimToLuna}.
 */

export type RewardMode = 'automatic';

/** A single reward adjustment. Phase 1 never produces any; Phase 2 will. */
export interface RewardAdjustment {
  /** Stable identifier for the rule that fired, e.g. `first-time-boost`. */
  kind: string;
  /** Signed delta applied to the running amount, in Luna. */
  deltaLuna: bigint;
  /** Human-readable reason, for audit/logging. */
  reason?: string;
}

export interface RewardResult {
  /** Final amount to send, in Luna (== `baselineAmount` in Phase 1). */
  amount: bigint;
  rewardMode: RewardMode;
  /** Configured baseline, in Luna. */
  baselineAmount: bigint;
  /** Applied adjustments — always `[]` in Phase 1. */
  adjustments: RewardAdjustment[];
}

const LUNA_PER_NIM = 100_000;

/**
 * Convert an operator-supplied NIM amount to Luna (bigint).
 *
 * Returns `0n` for any missing/invalid input (undefined, NaN, ≤ 0) so the
 * function is total — the caller is responsible for treating a non-positive
 * result as "no valid baseline" and refusing the payout. This keeps a
 * misconfiguration from throwing deep in the request path.
 */
export function nimToLuna(nim: number | undefined): bigint {
  if (nim === undefined || !Number.isFinite(nim) || nim <= 0) return 0n;
  return BigInt(Math.round(nim * LUNA_PER_NIM));
}

/**
 * Compute the automatic reward from config. Pure and total — never throws.
 *
 * For a missing/invalid baseline it returns `amount: 0n`; the caller decides
 * validity (and, per the abuse posture, refuses opaquely rather than echoing
 * the misconfiguration back to the client).
 */
export function calculateAutomaticReward(config: { baselineNim?: number | undefined }): RewardResult {
  const baseline = nimToLuna(config.baselineNim);
  return {
    amount: baseline,
    rewardMode: 'automatic',
    baselineAmount: baseline,
    // Phase 1: no adjustments. Phase 2 fills this and recomputes `amount`.
    adjustments: [],
  };
}

/** Minimal slice of `ServerConfig` the payout resolver needs. */
export interface PayoutConfig {
  automaticRewardsEnabled: boolean;
  automaticRewardsBaselineNim?: number | undefined;
  claimAmountLuna: bigint;
}

export interface ResolvedPayout {
  /** Amount (Luna) the handler should send and record. */
  amountLuna: bigint;
  /** Reward metadata when automatic mode is on; `null` for the explicit flow. */
  reward: RewardResult | null;
}

/**
 * Single seam between config and the claim handler.
 *
 * - Automatic mode OFF (default): use the operator-configured fixed
 *   `claimAmountLuna` — today's "explicit amount" behaviour, unchanged.
 * - Automatic mode ON: use the baseline from {@link calculateAutomaticReward}.
 *   An invalid baseline surfaces as `amountLuna <= 0n`, which the handler turns
 *   into an opaque rejection.
 */
export function resolvePayout(config: PayoutConfig): ResolvedPayout {
  if (config.automaticRewardsEnabled) {
    const reward = calculateAutomaticReward({ baselineNim: config.automaticRewardsBaselineNim });
    return { amountLuna: reward.amount, reward };
  }
  return { amountLuna: config.claimAmountLuna, reward: null };
}
