/**
 * Background reconciler for stuck `broadcast` claims.
 *
 * When the server restarts while `waitForConfirmation` is in-flight,
 * the claim's in-memory confirmation promise is lost and the row stays
 * at `broadcast` forever. This sweep polls the chain for those orphaned
 * claims and flips them to `confirmed` or `rejected`.
 */
import { and, eq, isNotNull, gte } from 'drizzle-orm';
import { DriverError } from '@faucet/core';
import type { AppContext } from './context.js';
import { claims } from './db/schema.js';
import { reconcilerFlips } from './metrics.js';

const LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function sweep(ctx: AppContext): Promise<number> {
  const cutoff = new Date(Date.now() - LOOKBACK_MS);
  const stuck = await ctx.db
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.status, 'broadcast'),
        isNotNull(claims.txId),
        gte(claims.createdAt, cutoff),
      ),
    );

  let flipped = 0;
  for (const claim of stuck) {
    try {
      await ctx.driver.waitForConfirmation(claim.txId!, 5_000);
      await ctx.db
        .update(claims)
        .set({ status: 'confirmed' })
        .where(eq(claims.id, claim.id));
      ctx.stream.publish({
        type: 'claim.confirmed',
        id: claim.id,
        address: claim.address,
        txId: claim.txId!,
      });
      reconcilerFlips.inc({ to: 'confirmed' });
      flipped++;
    } catch (err) {
      if (err instanceof DriverError && err.code === 'TX_REJECTED') {
        await ctx.db
          .update(claims)
          .set({ status: 'rejected', rejectionReason: 'tx expired/invalidated on-chain' })
          .where(eq(claims.id, claim.id));
        reconcilerFlips.inc({ to: 'rejected' });
        flipped++;
      }
      // CONFIRM_TIMEOUT → leave as broadcast, retry next sweep.
    }
  }
  return flipped;
}

export function startReconciler(ctx: AppContext): () => void {
  if (!ctx.config.reconcileEnabled) return () => {};

  const intervalMs = ctx.config.reconcileIntervalMs;

  const timer = setInterval(() => {
    void sweep(ctx).catch((err) => {
      // Log but don't crash — reconciler is best-effort.
      console.error('[reconcile] sweep error:', err);
    });
  }, intervalMs);

  // Run once immediately on startup.
  void sweep(ctx).catch(() => {});

  return () => clearInterval(timer);
}
