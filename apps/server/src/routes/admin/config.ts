/**
 * Admin config GET/PATCH.
 *
 * NOTE (M3): The running `ServerConfig` is immutable. This route persists
 * overrides to a `runtime_config` KV table; the overrides are NOT hot-reloaded
 * into the running pipeline yet. A follow-up milestone will merge the persisted
 * overrides into a `configOverrides` layer at request time. For now, PATCH
 * accepts and stores the values so the admin UI can roundtrip, but effect on
 * live traffic waits on that follow-up. Intentional for M3.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { runtimeConfig } from '../../db/schema.js';
import { writeAudit } from '../../auth/audit.js';
import { requireAdminCsrf } from '../../auth/middleware.js';

const PatchBody = z
  .object({
    claimAmountLuna: z.string().regex(/^\d+$/).optional(),
    rateLimitPerIpPerDay: z.number().int().min(1).max(10_000).optional(),
    abuseDenyThreshold: z.number().min(0).max(1).optional(),
    abuseReviewThreshold: z.number().min(0).max(1).optional(),
    layers: z
      .object({
        turnstile: z.boolean().optional(),
        hcaptcha: z.boolean().optional(),
        hashcash: z.boolean().optional(),
        geoip: z.boolean().optional(),
        fingerprint: z.boolean().optional(),
        onchain: z.boolean().optional(),
        ai: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

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
  app.get('/admin/config', async () => {
    const overrides = await readOverrides(ctx);
    const base = {
      claimAmountLuna: ctx.config.claimAmountLuna.toString(),
      rateLimitPerIpPerDay: ctx.config.rateLimitPerIpPerDay,
      abuseDenyThreshold: ctx.config.aiDenyThreshold,
      abuseReviewThreshold: ctx.config.aiReviewThreshold,
      layers: {
        turnstile: !!ctx.config.turnstileSiteKey,
        hcaptcha: !!ctx.config.hcaptchaSiteKey,
        hashcash: !!ctx.config.hashcashSecret,
        geoip: ctx.config.geoipBackend !== 'none',
        fingerprint: ctx.config.fingerprintEnabled,
        onchain: ctx.config.onchainEnabled,
        ai: ctx.config.aiEnabled,
      },
    };
    return { base, overrides };
  });

  app.patch(
    '/admin/config',
    { bodyLimit: 32 * 1024, preHandler: requireAdminCsrf },
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
      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'config.patch',
        signals: { keys: entries.map(([k]) => k) },
      });
      return reply.send({ ok: true, persistedKeys: entries.map(([k]) => k) });
    },
  );
}
