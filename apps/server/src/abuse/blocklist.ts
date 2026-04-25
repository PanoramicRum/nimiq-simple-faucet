import { and, eq } from 'drizzle-orm';
import { normalizeBlocklistValue, type AbuseCheck, type CheckResult } from '@faucet/core';
import type { Db } from '../db/index.js';
import { blocklist } from '../db/schema.js';

export function blocklistCheck(db: Db): AbuseCheck {
  return {
    id: 'blocklist',
    description: 'Admin-maintained IP / address / UID blocklist',
    weight: 5,
    async check(req): Promise<CheckResult> {
      const kinds: Array<[string, string | undefined]> = [
        ['ip', req.ip],
        ['address', req.address],
        ['uid', req.hostContext?.uid],
      ];
      for (const [kind, raw] of kinds) {
        if (!raw) continue;
        // Canonicalise so the lookup matches what the admin saved (#94).
        // Stored rows are normalised on insert via the same helper; existing
        // rows are migrated on boot — see migrateBlocklistNormalization().
        const value = normalizeBlocklistValue(kind, raw);
        const [hit] = await db
          .select()
          .from(blocklist)
          .where(and(eq(blocklist.kind, kind), eq(blocklist.value, value)))
          .limit(1);
        if (hit && (!hit.expiresAt || hit.expiresAt.getTime() > req.requestedAt)) {
          return {
            score: 1,
            decision: 'deny',
            reason: `blocklisted ${kind}`,
            signals: { kind, reason: hit.reason ?? null },
          };
        }
      }
      return { score: 0, signals: {} };
    },
  };
}
