import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { claims } from '../../db/schema.js';
import { writeAudit } from '../../auth/audit.js';
import { requireAdminCsrf } from '../../auth/middleware.js';
import { ClaimsListQuery as ListQuery } from '../../openapi/schemas.js';

export async function adminClaimsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/admin/claims', async (req, reply) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid query' });
    const { limit, offset, status, decision, address } = parsed.data;

    const conds: SQL[] = [];
    if (status) conds.push(eq(claims.status, status));
    if (decision) conds.push(eq(claims.decision, decision));
    if (address) conds.push(eq(claims.address, address));
    const where = conds.length > 0 ? and(...conds) : undefined;

    const rowsQuery = where
      ? ctx.db.select().from(claims).where(where)
      : ctx.db.select().from(claims);
    const rows = await rowsQuery.orderBy(desc(claims.createdAt)).limit(limit).offset(offset);

    const countQuery = where
      ? ctx.db.select({ n: sql<number>`count(*)` }).from(claims).where(where)
      : ctx.db.select({ n: sql<number>`count(*)` }).from(claims);
    const total = await countQuery;

    return {
      total: total[0]?.n ?? 0,
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        address: r.address,
        status: r.status,
        decision: r.decision,
        txId: r.txId,
        ip: r.ip,
        integratorId: r.integratorId,
        abuseScore: r.abuseScore,
        rejectionReason: r.rejectionReason,
      })),
    };
  });

  app.get('/admin/claims/:id/explain', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(claims).where(eq(claims.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'not found' });
    let signals: unknown = {};
    try {
      signals = JSON.parse(row.signalsJson);
    } catch {
      signals = {};
    }
    return { ...row, signals };
  });

  app.post(
    '/admin/claims/:id/allow',
    { bodyLimit: 32 * 1024, preHandler: requireAdminCsrf(ctx) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await ctx.db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!row) return reply.code(404).send({ error: 'not found' });
      await ctx.db
        .update(claims)
        .set({ status: 'manual-allow', decision: 'allow', rejectionReason: null })
        .where(eq(claims.id, id));
      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'claim.allow',
        target: id,
        signals: { prevStatus: row.status, prevDecision: row.decision },
      });
      return reply.send({ ok: true });
    },
  );

  app.post(
    '/admin/claims/:id/deny',
    { bodyLimit: 32 * 1024, preHandler: requireAdminCsrf(ctx) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { reason?: string };
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 256) : 'manual deny';
      const [row] = await ctx.db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!row) return reply.code(404).send({ error: 'not found' });
      await ctx.db
        .update(claims)
        .set({ status: 'rejected', decision: 'deny', rejectionReason: reason })
        .where(eq(claims.id, id));
      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'claim.deny',
        target: id,
        signals: { prevStatus: row.status, prevDecision: row.decision, reason },
      });
      return reply.send({ ok: true });
    },
  );
}
