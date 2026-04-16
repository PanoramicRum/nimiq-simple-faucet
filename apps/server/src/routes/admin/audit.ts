import type { FastifyInstance } from 'fastify';
import { desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { auditLog } from '../../db/schema.js';

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function adminAuditRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/admin/audit-log', async (req, reply) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid query' });
    const { limit, offset } = parsed.data;
    const rows = await ctx.db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.ts))
      .limit(limit)
      .offset(offset);
    const total = await ctx.db.select({ n: sql<number>`count(*)` }).from(auditLog);
    return {
      total: total[0]?.n ?? 0,
      items: rows.map((r) => {
        let signals: unknown = {};
        try {
          signals = JSON.parse(r.signalsJson);
        } catch {
          signals = {};
        }
        return {
          id: r.id,
          ts: r.ts,
          actor: r.actor,
          action: r.action,
          target: r.target,
          signals,
        };
      }),
    };
  });
}
