/**
 * First-time-claimant detection for the first-time reward boost.
 *
 * A claimant is "first-time" if NO prior **paid** claim (`decision='allow' AND
 * tx_id IS NOT NULL`) matches on ANY enabled identity dimension. IP + address
 * are always checked; the device fingerprint `visitorId` and the integrator
 * `uid` are admin-opt-in extra dimensions. Because the dimensions are OR-ed, a
 * returning user on *any* enabled signal is correctly denied the boost — so
 * enabling more dimensions only makes the boost harder to farm.
 *
 * Security: `uid` is only ever passed in (and recorded) when the host context
 * was HMAC-verified by an integrator; a forgeable/unverified uid must never
 * reach this query. `visitorId` is client-rotatable, so it can only *deny* the
 * boost, never grant one (the always-on IP+address gate backstops a rotation).
 */
import { and, eq, isNotNull, or, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { claims } from '../db/schema.js';

export interface FirstTimeQuery {
  ip: string;
  address: string;
  /** Device fingerprint visitorId for this claim, if any. */
  fingerprintVisitorId?: string | null | undefined;
  /** Integrator uid for this claim — pass only when HMAC-verified. */
  hostUid?: string | null | undefined;
  useFingerprint: boolean;
  useUid: boolean;
}

export async function isFirstTimeClaimant(db: Db, q: FirstTimeQuery): Promise<boolean> {
  const dims: SQL[] = [eq(claims.ip, q.ip), eq(claims.address, q.address)];
  if (q.useFingerprint && q.fingerprintVisitorId) {
    dims.push(eq(claims.fingerprintVisitorId, q.fingerprintVisitorId));
  }
  if (q.useUid && q.hostUid) {
    dims.push(eq(claims.hostUid, q.hostUid));
  }

  const [row] = await db
    .select({ id: claims.id })
    .from(claims)
    .where(and(eq(claims.decision, 'allow'), isNotNull(claims.txId), or(...dims)))
    .limit(1);

  return row === undefined;
}
