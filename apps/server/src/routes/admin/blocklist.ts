import type { FastifyInstance } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { blocklist } from '../../db/schema.js';
import { writeAudit } from '../../auth/audit.js';
import { requireAdminCsrf } from '../../auth/middleware.js';

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const CreateBody = z.object({
  kind: z.enum(['ip', 'address', 'uid', 'asn', 'country']),
  value: z.string().min(1).max(128),
  reason: z.string().max(256).optional(),
  expiresAt: z.union([z.string(), z.number()]).optional(),
});

export async function adminBlocklistRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/admin/blocklist', async (req, reply) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid query' });
    const { limit, offset } = parsed.data;
    const rows = await ctx.db
      .select()
      .from(blocklist)
      .orderBy(desc(blocklist.createdAt))
      .limit(limit)
      .offset(offset);
    const total = await ctx.db.select({ n: sql<number>`count(*)` }).from(blocklist);
    return { total: total[0]?.n ?? 0, items: rows };
  });

  app.post(
    '/admin/blocklist',
    { bodyLimit: 32 * 1024, preHandler: requireAdminCsrf },
    async (req, reply) => {
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
      const id = nanoid();
      let expiresAt: Date | null = null;
      if (parsed.data.expiresAt !== undefined) {
        const d =
          typeof parsed.data.expiresAt === 'number'
            ? new Date(parsed.data.expiresAt)
            : new Date(parsed.data.expiresAt);
        if (Number.isNaN(d.getTime())) {
          return reply.code(400).send({ error: 'invalid expiresAt' });
        }
        expiresAt = d;
      }
      await ctx.db.insert(blocklist).values({
        id,
        kind: parsed.data.kind,
        value: parsed.data.value,
        reason: parsed.data.reason ?? null,
        createdAt: new Date(),
        expiresAt,
      });
      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'blocklist.add',
        target: id,
        signals: { kind: parsed.data.kind, value: parsed.data.value },
      });
      return reply.code(201).send({ id });
    },
  );

  app.delete(
    '/admin/blocklist/:id',
    { bodyLimit: 32 * 1024, preHandler: requireAdminCsrf },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await ctx.db.select().from(blocklist).where(eq(blocklist.id, id)).limit(1);
      if (!row) return reply.code(404).send({ error: 'not found' });
      await ctx.db.delete(blocklist).where(eq(blocklist.id, id));
      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'blocklist.remove',
        target: id,
        signals: { kind: row.kind, value: row.value },
      });
      return reply.send({ ok: true });
    },
  );
}
