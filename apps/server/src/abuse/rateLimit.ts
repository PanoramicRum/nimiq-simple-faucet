import { and, eq, sql } from 'drizzle-orm';
import type { AbuseCheck, CheckResult } from '@faucet/core';
import type { Db } from '../db/index.js';
import { ipCounters } from '../db/schema.js';

export interface RateLimitCheckConfig {
  perIpPerDay: number;
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function rateLimitCheck(db: Db, config: RateLimitCheckConfig): AbuseCheck {
  return {
    id: 'rate-limit',
    description: 'Per-IP daily claim cap',
    weight: 3,
    async check(req): Promise<CheckResult> {
      const day = utcDay(req.requestedAt);
      const [row] = await db
        .select()
        .from(ipCounters)
        .where(and(eq(ipCounters.ip, req.ip), eq(ipCounters.day, day)))
        .limit(1);
      const count = row?.count ?? 0;
      if (count >= config.perIpPerDay) {
        return {
          score: 1,
          decision: 'deny',
          reason: `ip reached daily cap (${count}/${config.perIpPerDay})`,
          signals: { ip: req.ip, day, count, cap: config.perIpPerDay },
        };
      }
      const score = Math.min(count / Math.max(config.perIpPerDay, 1), 0.6);
      return { score, signals: { ip: req.ip, day, count, cap: config.perIpPerDay } };
    },
  };
}

export async function incrementIpCounter(db: Db, ip: string, now: number): Promise<void> {
  const day = utcDay(now);
  await db
    .insert(ipCounters)
    .values({ ip, day, count: 1 })
    .onConflictDoUpdate({
      target: [ipCounters.ip, ipCounters.day],
      set: { count: sql`${ipCounters.count} + 1` },
    });
}
