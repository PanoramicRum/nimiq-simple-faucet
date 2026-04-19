/**
 * Background reconciler for stuck `broadcast` claims.
 *
 * When the server restarts while `waitForConfirmation` is in-flight,
 * the claim's in-memory confirmation promise is lost and the row stays
 * at `broadcast` forever. This sweep polls the chain for those orphaned
 * claims and flips them to `confirmed` or `rejected`.
 */
import { and, eq, isNotNull, gte, or } from 'drizzle-orm';
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
        or(eq(claims.status, 'broadcast'), eq(claims.status, 'timeout')),
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
          .set({ status: 'expired', rejectionReason: 'tx expired/invalidated on-chain' })
          .where(eq(claims.id, claim.id));
        reconcilerFlips.inc({ to: 'expired' });
        flipped++;
      } else if (err instanceof DriverError && err.code === 'CONFIRM_TIMEOUT') {
        // Mark as timeout so the dashboard shows it distinctly from
        // fresh broadcasts. Next sweep will retry.
        await ctx.db
          .update(claims)
          .set({ status: 'timeout' })
          .where(eq(claims.id, claim.id));
      }
      // Other errors: leave as-is, retry next sweep.
    }
  }
  return flipped;
}

export function startReconciler(ctx: AppContext): () => void {
  if (!ctx.config.reconcileEnabled) return () => {};

  const intervalMs = ctx.config.reconcileIntervalMs;

  const runSweep = (): void => {
    void sweep(ctx).then((flipped) => {
      if (flipped > 0) {
        ctx.events.push({
          type: 'reconciler_sweep',
          message: `${flipped} claim${flipped > 1 ? 's' : ''} reconciled`,
        });
      }
    }).catch((err) => {
      // Log but don't crash — reconciler is best-effort.
      console.error('[reconcile] sweep error:', err);
    });
  };

  const timer = setInterval(runSweep, intervalMs);

  // Run once immediately on startup.
  runSweep();

  return () => clearInterval(timer);
}
