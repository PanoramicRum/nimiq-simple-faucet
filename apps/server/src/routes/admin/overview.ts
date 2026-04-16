import type { FastifyInstance } from 'fastify';
import { and, gte, isNotNull, sql } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { claims } from '../../db/schema.js';

export async function adminOverviewRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/admin/overview', async () => {
    const now = Date.now();
    const hourAgo = new Date(now - 60 * 60_000);
    const dayAgo = new Date(now - 24 * 60 * 60_000);

    const [lastHour, last24h] = await Promise.all([
      ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(claims)
        .where(gte(claims.createdAt, hourAgo)),
      ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(claims)
        .where(gte(claims.createdAt, dayAgo)),
    ]);

    const bucket = await ctx.db
      .select({ decision: claims.decision, n: sql<number>`count(*)` })
      .from(claims)
      .where(gte(claims.createdAt, dayAgo))
      .groupBy(claims.decision);

    let total = 0;
    let allow = 0;
    for (const r of bucket) {
      total += r.n;
      if (r.decision === 'allow') allow += r.n;
    }
    const successRate = total > 0 ? allow / total : 0;

    const topReasons = await ctx.db
      .select({ reason: claims.rejectionReason, n: sql<number>`count(*)` })
      .from(claims)
      .where(and(gte(claims.createdAt, dayAgo), isNotNull(claims.rejectionReason)))
      .groupBy(claims.rejectionReason)
      .orderBy(sql`count(*) desc`)
      .limit(5);

    let balance = '0';
    try {
      balance = (await ctx.driver.getBalance()).toString();
    } catch {
      balance = '0';
    }

    return {
      balance,
      claimsLastHour: lastHour[0]?.n ?? 0,
      claimsLast24h: last24h[0]?.n ?? 0,
      successRate,
      topRejectionReasons: topReasons.map((r) => ({
        reason: r.reason ?? 'unknown',
        count: r.n,
      })),
    };
  });
}
