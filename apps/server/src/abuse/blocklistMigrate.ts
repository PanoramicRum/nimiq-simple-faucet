/**
 * One-shot migration: walk every `blocklist` row at boot and rewrite its
 * `value` column with the canonical form from `normalizeBlocklistValue`.
 * Without this, entries created before the normalization fix (#94) are
 * still in their raw shape (e.g. `::ffff:1.2.3.4`) and the now-normalised
 * lookup quietly misses them.
 *
 * Idempotent: re-normalising an already-canonical value is a no-op, so a
 * row that was created post-fix doesn't change. We skip the UPDATE when
 * the new value equals the old to avoid churning timestamps in any
 * downstream materialised view.
 */
import { eq } from 'drizzle-orm';
import { normalizeBlocklistValue } from '@faucet/core';
import type { Db } from '../db/index.js';
import { blocklist } from '../db/schema.js';

export interface MigrateResult {
  inspected: number;
  updated: number;
}

export async function migrateBlocklistNormalization(db: Db): Promise<MigrateResult> {
  const rows = await db.select().from(blocklist);
  let updated = 0;
  for (const row of rows) {
    const canonical = normalizeBlocklistValue(row.kind, row.value);
    if (canonical !== row.value) {
      await db.update(blocklist).set({ value: canonical }).where(eq(blocklist.id, row.id));
      updated += 1;
    }
  }
  return { inspected: rows.length, updated };
}
