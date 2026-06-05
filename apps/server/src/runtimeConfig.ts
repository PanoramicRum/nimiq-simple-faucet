/**
 * Shared reader for admin runtime-config overrides (the `runtime_config`
 * key→valueJson table written by `PATCH /admin/config`).
 *
 * Lives in a neutral module so both the admin routes and the claim handler can
 * read overrides without the claim path importing from `routes/admin/`. Most
 * overrides are only applied on restart, but a small explicit set (the
 * low-balance reward keys) is read here at claim time to apply live.
 */
import type { Db } from './db/index.js';
import { runtimeConfig } from './db/schema.js';

export async function readRuntimeOverrides(db: Db): Promise<Record<string, unknown>> {
  const rows = await db.select().from(runtimeConfig);
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.valueJson);
    } catch {
      // skip malformed row
    }
  }
  return out;
}
