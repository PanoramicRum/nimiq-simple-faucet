import type { FastifyInstance } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { normalizeBlocklistValue } from '@faucet/core';
import type { AppContext } from '../../context.js';
import { blocklist } from '../../db/schema.js';
import { writeAudit } from '../../auth/audit.js';
import { requireAdminCsrf } from '../../auth/middleware.js';
import {
  BlocklistListQuery as ListQuery,
  BlocklistCreateRequest as CreateBody,
} from '../../openapi/schemas.js';

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
    { bodyLimit: 32 * 1024, preHandler: requireAdminCsrf(ctx) },
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
      // Canonicalise on insert so the lookup at request time matches
      // regardless of how the admin typed the value (#94).
      const normalizedValue = normalizeBlocklistValue(parsed.data.kind, parsed.data.value);
      await ctx.db.insert(blocklist).values({
        id,
        kind: parsed.data.kind,
        value: normalizedValue,
        reason: parsed.data.reason ?? null,
        createdAt: new Date(),
        expiresAt,
      });
      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'blocklist.add',
        target: id,
        signals: { kind: parsed.data.kind, value: normalizedValue },
      });
      return reply.code(201).send({ id });
    },
  );

  app.delete(
    '/admin/blocklist/:id',
    { bodyLimit: 32 * 1024, preHandler: requireAdminCsrf(ctx) },
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
