/**
 * Repeat-user reduction: count a claimant's recent **paid** claims and derive a
 * graduated reward reduction from the configured tiers.
 *
 * Three rolling windows — day (24h), week (7d), month (30d) — each with a
 * claim-count threshold and a reduction percent. A prior **paid** claim
 * (`decision='allow' AND tx_id IS NOT NULL`) counts toward the total if it
 * matches on ANY enabled identity dimension (address / IP / device fingerprint
 * visitorId), OR-ed/unioned exactly like {@link ../rewards/firstTime}. Enabling
 * more dimensions only makes the counts larger (stricter), never smaller.
 *
 * Largest tier wins: when several tiers trigger, the effective reduction is the
 * single biggest triggered tier's percent — bounded and predictable.
 *
 * The window math mirrors the proven, dialect-safe count in
 * {@link ../abuse/recentClaimsQuery} (`COUNT(*)` + `created_at >= since`). `now`
 * is supplied by the caller so the function is deterministic and unit-testable.
 */
import { and, eq, gte, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { claims } from '../db/schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

export interface RepeatClaimQuery {
  address: string;
  ip: string;
  /** Device fingerprint visitorId for this claim, if any. */
  fingerprintVisitorId?: string | null | undefined;
  useAddress: boolean;
  useIp: boolean;
  useFingerprint: boolean;
  /** Reference time (ms since epoch) the rolling windows are measured back from. */
  now: number;
  needDay: boolean;
  needWeek: boolean;
  needMonth: boolean;
}

export interface RepeatClaimCounts {
  day: number;
  week: number;
  month: number;
}

/** The six tier numbers (a structural subset of `EffectiveRewardSettings`). */
export interface RepeatReductionTiers {
  repeatReductionDailyThreshold?: number | undefined;
  repeatReductionDailyPercent?: number | undefined;
  repeatReductionWeeklyThreshold?: number | undefined;
  repeatReductionWeeklyPercent?: number | undefined;
  repeatReductionMonthlyThreshold?: number | undefined;
  repeatReductionMonthlyPercent?: number | undefined;
}

/** A tier is configured (can ever trigger) when it has an integer threshold ≥ 1 and a percent > 0. */
export function isRepeatTierConfigured(
  threshold: number | undefined,
  percent: number | undefined,
): boolean {
  return (
    threshold !== undefined &&
    Number.isFinite(threshold) &&
    threshold >= 1 &&
    percent !== undefined &&
    Number.isFinite(percent) &&
    percent > 0
  );
}

/**
 * Count paid claims attributable to this identity within each requested window.
 * Returns 0 for every window when no dimension is enabled (or a fingerprint-only
 * setup has no visitorId for this claim) and 0 for any window not requested.
 */
export async function countRepeatClaims(db: Db, q: RepeatClaimQuery): Promise<RepeatClaimCounts> {
  const dims: SQL[] = [];
  if (q.useAddress) dims.push(eq(claims.address, q.address));
  if (q.useIp) dims.push(eq(claims.ip, q.ip));
  if (q.useFingerprint && q.fingerprintVisitorId) {
    dims.push(eq(claims.fingerprintVisitorId, q.fingerprintVisitorId));
  }

  if (dims.length === 0) return { day: 0, week: 0, month: 0 };

  const paidOnIdentity = and(eq(claims.decision, 'allow'), isNotNull(claims.txId), or(...dims));

  const countSince = async (windowMs: number): Promise<number> => {
    const since = new Date(q.now - windowMs);
    const [row] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(claims)
      .where(and(paidOnIdentity, gte(claims.createdAt, since)));
    return row?.n ?? 0;
  };

  return {
    day: q.needDay ? await countSince(DAY_MS) : 0,
    week: q.needWeek ? await countSince(WEEK_MS) : 0,
    month: q.needMonth ? await countSince(MONTH_MS) : 0,
  };
}

/**
 * Effective repeat reduction percent: the MAX percent across all *triggered*
 * tiers (largest tier wins). A tier triggers when it is configured
 * ({@link isRepeatTierConfigured}) and the matching window count meets its
 * threshold. Returns 0 when nothing triggers. Pure — unit-testable in isolation.
 */
export function effectiveRepeatReductionPercent(
  counts: RepeatClaimCounts,
  tiers: RepeatReductionTiers,
): number {
  let percent = 0;
  const consider = (
    threshold: number | undefined,
    pct: number | undefined,
    count: number,
  ): void => {
    // Early-return on undefined so both narrow to `number` below (no casts).
    if (threshold === undefined || pct === undefined) return;
    if (!isRepeatTierConfigured(threshold, pct) || count < threshold) return;
    if (pct > percent) percent = pct;
  };
  consider(tiers.repeatReductionDailyThreshold, tiers.repeatReductionDailyPercent, counts.day);
  consider(tiers.repeatReductionWeeklyThreshold, tiers.repeatReductionWeeklyPercent, counts.week);
  consider(tiers.repeatReductionMonthlyThreshold, tiers.repeatReductionMonthlyPercent, counts.month);
  return percent;
}
