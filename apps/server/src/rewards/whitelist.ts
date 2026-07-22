/**
 * Reward-whitelist lookup for the whitelist bonus (§2.4.5).
 *
 * Operators list identities (Nimiq address, or integrator `uid`) that should
 * receive a larger — or exact — payout in automatic reward mode: partner
 * integrators, CI wallets, demo accounts. An entry can carry its own
 * `bonusPercent` and/or `exactAmountNim`; an entry with neither falls back to
 * the global `whitelistBonusPercent` setting at calculation time.
 *
 * Matching mirrors the other identity helpers: values are canonicalized with
 * {@link normalizeBlocklistValue} on BOTH the write path (admin REST + MCP)
 * and this read path, and `uid` must only be passed in when the host context
 * was HMAC-verified — a forgeable uid must never select an entry.
 *
 * When several entries match (e.g. both the address and the verified uid are
 * listed), the **most generous entry wins**, mirroring the repeat-reduction
 * "largest tier wins" convention: any entry with a positive `exactAmountNim`
 * beats percent-only entries (largest exact amount first), otherwise the
 * largest per-entry `bonusPercent` wins, with percent-less entries last.
 */
import { and, eq, or, type SQL } from 'drizzle-orm';
import { normalizeBlocklistValue } from '@faucet/core';
import type { Db } from '../db/index.js';
import { rewardWhitelist } from '../db/schema.js';

export interface WhitelistQuery {
  address: string;
  /** Integrator uid for this claim — pass only when HMAC-verified. */
  hostUid?: string | null | undefined;
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
 * At most two dimensions are queried (address always; uid when verified), so
 * the result set is tiny — selection happens in JS for clarity.
 */
export async function findWhitelistMatch(db: Db, q: WhitelistQuery): Promise<WhitelistMatch | null> {
  const dims: SQL[] = [
    and(
      eq(rewardWhitelist.kind, 'address'),
      eq(rewardWhitelist.value, normalizeBlocklistValue('address', q.address)),
    )!,
  ];
  if (q.hostUid) {
    dims.push(
      and(
        eq(rewardWhitelist.kind, 'uid'),
        eq(rewardWhitelist.value, normalizeBlocklistValue('uid', q.hostUid)),
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

  // Most generous wins: exact-amount entries first (largest amount), then the
  // largest per-entry percent, then percent-less entries (global fallback).
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
    const bestExact = best.exactAmountNim ?? 0;
    const candExact = candidate.exactAmountNim ?? 0;
    if (candExact !== bestExact) {
      if (candExact > bestExact) best = candidate;
      continue;
    }
    if ((candidate.bonusPercent ?? -1) > (best.bonusPercent ?? -1)) best = candidate;
  }
  return best;
}
