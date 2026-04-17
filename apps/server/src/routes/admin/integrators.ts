import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { integratorKeys } from '../../db/schema.js';
import { writeAudit } from '../../auth/audit.js';
import { requireAdminCsrf } from '../../auth/middleware.js';
import { IntegratorCreateRequest as CreateBody } from '../../openapi/schemas.js';

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
function mintApiKey(): string {
  return `fk_${randomBytes(24).toString('base64url')}`;
}
function mintHmacSecret(): string {
  return randomBytes(32).toString('base64url');
}

export async function adminIntegratorsRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get('/admin/integrators', async () => {
    const rows = await ctx.db.select().from(integratorKeys).orderBy(desc(integratorKeys.createdAt));
    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        revokedAt: r.revokedAt,
      })),
    };
  });

  app.post(
    '/admin/integrators',
    { bodyLimit: 32 * 1024, preHandler: requireAdminCsrf },
    async (req, reply) => {
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
      const { id } = parsed.data;
      const [existing] = await ctx.db
        .select()
        .from(integratorKeys)
        .where(eq(integratorKeys.id, id))
        .limit(1);
      if (existing) return reply.code(409).send({ error: 'integrator exists' });
      const apiKey = mintApiKey();
      const hmacSecret = mintHmacSecret();
      await ctx.db.insert(integratorKeys).values({
        id,
        apiKeyHash: sha256Hex(apiKey),
        hmacSecret,
        createdAt: new Date(),
      });
      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'integrator.create',
        target: id,
      });
      return reply.code(201).send({ id, apiKey, hmacSecret });
    },
  );

  app.post(
    '/admin/integrators/:id/rotate',
    { bodyLimit: 32 * 1024, preHandler: requireAdminCsrf },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await ctx.db.select().from(integratorKeys).where(eq(integratorKeys.id, id)).limit(1);
      if (!row) return reply.code(404).send({ error: 'not found' });
      const apiKey = mintApiKey();
      const hmacSecret = mintHmacSecret();
      // Optimistic locking: only update if the key hash hasn't changed
      // since we read it. Prevents concurrent rotations from silently
      // overwriting each other (#53).
      const result = ctx.db
        .update(integratorKeys)
        .set({ apiKeyHash: sha256Hex(apiKey), hmacSecret, revokedAt: null })
        .where(and(eq(integratorKeys.id, id), eq(integratorKeys.apiKeyHash, row.apiKeyHash)))
        .run();
      if ((result as { changes?: number }).changes === 0) {
        return reply.code(409).send({ error: 'concurrent rotation detected, retry' });
      }
      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'integrator.rotate',
        target: id,
      });
      return reply.send({ id, apiKey, hmacSecret });
    },
  );

  app.delete(
    '/admin/integrators/:id',
    { bodyLimit: 32 * 1024, preHandler: requireAdminCsrf },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await ctx.db.select().from(integratorKeys).where(eq(integratorKeys.id, id)).limit(1);
      if (!row) return reply.code(404).send({ error: 'not found' });
      await ctx.db
        .update(integratorKeys)
        .set({ revokedAt: new Date() })
        .where(eq(integratorKeys.id, id));
      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'integrator.revoke',
        target: id,
      });
      return reply.send({ ok: true });
    },
  );
}
