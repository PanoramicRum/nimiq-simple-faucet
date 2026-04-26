/**
 * Admin config GET/PATCH.
 *
 * Layer toggles (fingerprint, onchain, AI) take effect immediately on PATCH —
 * the abuse pipeline is rebuilt in memory. Other overrides (claim amount, rate
 * limit thresholds) are persisted but require a restart to apply.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { runtimeConfig } from '../../db/schema.js';
import { buildPipeline } from '../../abuse/pipeline.js';
import { writeAudit } from '../../auth/audit.js';
import { requireAdminCsrf } from '../../auth/middleware.js';
import { AdminConfigPatch as PatchBody } from '../../openapi/schemas.js';
import { deriveAdminConfigBase } from '../../configView.js';

async function readOverrides(ctx: AppContext): Promise<Record<string, unknown>> {
  const rows = await ctx.db.select().from(runtimeConfig);
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

export async function adminConfigRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/admin/config', async () => ({
    base: deriveAdminConfigBase(ctx.config),
    overrides: await readOverrides(ctx),
  }));

  app.patch(
    '/admin/config',
    { bodyLimit: 32 * 1024, preHandler: requireAdminCsrf(ctx) },
    async (req, reply) => {
      const parsed = PatchBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
      }
      const entries = Object.entries(parsed.data);
      for (const [k, v] of entries) {
        const existing = await ctx.db
          .select()
          .from(runtimeConfig)
          .where(eq(runtimeConfig.key, k))
          .limit(1);
        const valueJson = JSON.stringify(v);
        if (existing[0]) {
          await ctx.db.update(runtimeConfig).set({ valueJson }).where(eq(runtimeConfig.key, k));
        } else {
          await ctx.db.insert(runtimeConfig).values({ key: k, valueJson });
        }
      }
      // Rebuild the abuse pipeline with the new layer overrides so they
      // take effect immediately without a restart.
      const allOverrides = await readOverrides(ctx);
      const layers = (allOverrides.layers ?? {}) as Record<string, boolean>;
      ctx.pipeline = buildPipeline(ctx.db, ctx.config, ctx.driver, {
        fingerprintEnabled: layers.fingerprint,
        onchainEnabled: layers.onchain,
        aiEnabled: layers.ai,
      });

      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'config.patch',
        signals: { keys: entries.map(([k]) => k) },
      });
      return reply.send({ ok: true, persistedKeys: entries.map(([k]) => k) });
    },
  );
}
