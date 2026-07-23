/**
 * Reward-whitelist lookup for the whitelist bonus (§2.4.5).
 *
 * Operators list identities that should receive a larger — or exact — payout
 * in automatic reward mode: partner integrators, CI wallets, demo accounts.
 * An entry can carry its own `bonusPercent` and/or `exactAmountNim`; an entry
 * with neither realizes the global `whitelistBonusPercent` setting.
 *
 * Two entry kinds with different trust requirements:
 *  - `address` — matched against the claim's (driver-parsed) payout address.
 *  - `uid` — value-granting uid matches demand the STRONG verification path:
 *    the claim must be authenticated with the full integrator request HMAC
 *    (which binds the payout address into the signed body and carries a
 *    single-use nonce), AND the entry is bound to that integrator via
 *    `integratorId`. The per-field hostContext signature (§1.4) is NOT
 *    accepted here — it covers only the context fields, so a captured
 *    signature could be replayed against an attacker-chosen address, and any
 *    integrator could sign someone else's uid. (The first-time boost's uid
 *    dimension is unaffected: there the uid can only make the boost harder
 *    to obtain, never redirect value.)
 *
 * Values are canonicalized with {@link normalizeBlocklistValue} on BOTH the
 * write path (admin REST + MCP) and this read path.
 *
 * When several entries match, selection is two-class:
 *  1. Exact-amount entries are an OVERRIDE class — an operator pinned the
 *     payout, so any entry with `exactAmountNim > 0` beats every percent
 *     entry; among several, the largest exact amount wins.
 *  2. Otherwise the largest REALIZED percent wins, where a percent-less
 *     entry realizes the global default (`globalBonusPercent`) — so a
 *     default-percent entry is not spuriously outranked by a smaller
 *     per-entry percent.
 */
import { and, eq, or, type SQL } from 'drizzle-orm';
import { normalizeBlocklistValue } from '@faucet/core';
import type { Db } from '../db/index.js';
import { rewardWhitelist } from '../db/schema.js';

export interface WhitelistQuery {
  address: string;
  /**
   * Integrator uid — pass ONLY when the claim was authenticated via the full
   * integrator request HMAC (not the per-field hostContext signature).
   */
  hostUid?: string | null | undefined;
  /** The authenticated integrator id for the same full-HMAC request. */
  integratorId?: string | null | undefined;
  /** Effective global default bonus percent, for realized-percent comparison. */
  globalBonusPercent?: number | undefined;
}

/** The per-entry reward overrides of the winning whitelist match. */
export interface WhitelistMatch {
  /** Per-entry bonus percent, or `null` to fall back to the global default. */
  bonusPercent: number | null;
  /** Per-entry exact payout in NIM; takes precedence over any percent. */
  exactAmountNim: number | null;
}

/**
 * Find the winning whitelist entry for a claimant, or `null` when none match.
 * At most two dimensions are queried, so the result set is tiny — selection
 * happens in JS for clarity.
 */
export async function findWhitelistMatch(db: Db, q: WhitelistQuery): Promise<WhitelistMatch | null> {
  const dims: SQL[] = [
    and(
      eq(rewardWhitelist.kind, 'address'),
      eq(rewardWhitelist.value, normalizeBlocklistValue('address', q.address)),
    )!,
  ];
  if (q.hostUid && q.integratorId) {
    dims.push(
      and(
        eq(rewardWhitelist.kind, 'uid'),
        eq(rewardWhitelist.value, normalizeBlocklistValue('uid', q.hostUid)),
        // uid grants are bound to the integrator that authenticated this
        // request — another integrator's valid HMAC must not select them.
        eq(rewardWhitelist.integratorId, q.integratorId),
      )!,
    );
  }

  const rows = await db
    .select({
      bonusPercent: rewardWhitelist.bonusPercent,
      exactAmountNim: rewardWhitelist.exactAmountNim,
    })
    .from(rewardWhitelist)
    .where(or(...dims));

  if (rows.length === 0) return null;

  const globalPercent =
    q.globalBonusPercent !== undefined && Number.isFinite(q.globalBonusPercent)
      ? q.globalBonusPercent
      : 0;
  const realizedPercent = (m: WhitelistMatch): number => m.bonusPercent ?? globalPercent;
  const exactOf = (m: WhitelistMatch): number =>
    m.exactAmountNim !== null && m.exactAmountNim > 0 ? m.exactAmountNim : 0;

  let best: WhitelistMatch | null = null;
  for (const row of rows) {
    const candidate: WhitelistMatch = {
      bonusPercent: row.bonusPercent ?? null,
      exactAmountNim: row.exactAmountNim ?? null,
    };
    if (best === null) {
      best = candidate;
      continue;
    }
    // Exact-amount override class first; then largest realized percent.
    if (exactOf(candidate) !== exactOf(best)) {
      if (exactOf(candidate) > exactOf(best)) best = candidate;
      continue;
    }
    if (realizedPercent(candidate) > realizedPercent(best)) best = candidate;
  }
  return best;
}
