import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { normalizeBlocklistValue } from '@faucet/core';
import type { AppContext } from '../../context.js';
import { rewardWhitelist } from '../../db/schema.js';
import { writeAudit } from '../../auth/audit.js';
import { requireAdminCsrf } from '../../auth/middleware.js';
import {
  BlocklistListQuery as ListQuery,
  RewardWhitelistCreateRequest as CreateBody,
} from '../../openapi/schemas.js';

/**
 * Reward-whitelist CRUD (§2.4.5) — the operator-managed list of identities
 * that receive a whitelist bonus (or exact payout) in automatic reward mode.
 * Same shape as the blocklist routes; values are canonicalized on insert so
 * the claim-time lookup matches regardless of how the admin typed them.
 */
export async function adminRewardWhitelistRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get('/admin/reward-whitelist', async (req, reply) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid query', code: 'INVALID_QUERY' });
    const { limit, offset } = parsed.data;
    const rows = await ctx.db
      .select()
      .from(rewardWhitelist)
      .orderBy(desc(rewardWhitelist.createdAt))
      .limit(limit)
      .offset(offset);
    const total = await ctx.db.select({ n: sql<number>`count(*)` }).from(rewardWhitelist);
    return { total: total[0]?.n ?? 0, items: rows };
  });

  app.post(
    '/admin/reward-whitelist',
    { bodyLimit: 32 * 1024, preHandler: requireAdminCsrf(ctx) },
    async (req, reply) => {
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid body', code: 'INVALID_BODY' });
      // Cross-field rule (see RewardWhitelistCreateRequest): uid grants must
      // be bound to the integrator whose full-HMAC requests they match;
      // address entries have no integrator dimension.
      if (parsed.data.kind === 'uid' && !parsed.data.integratorId) {
        return reply
          .code(400)
          .send({ error: 'uid entries require integratorId', code: 'INVALID_BODY' });
      }
      if (parsed.data.kind === 'address' && parsed.data.integratorId) {
        return reply
          .code(400)
          .send({ error: 'address entries must not set integratorId', code: 'INVALID_BODY' });
      }
      const id = nanoid();
      // Canonicalise on insert so the claim-time lookup matches regardless of
      // how the admin typed the value (same rationale as the blocklist, #94).
      const normalizedValue = normalizeBlocklistValue(parsed.data.kind, parsed.data.value);
      // The (kind, value) unique index would reject a duplicate anyway;
      // pre-check so the admin gets a clean 409 instead of a driver error.
      const [existing] = await ctx.db
        .select({ id: rewardWhitelist.id })
        .from(rewardWhitelist)
        .where(
          and(eq(rewardWhitelist.kind, parsed.data.kind), eq(rewardWhitelist.value, normalizedValue)),
        )
        .limit(1);
      if (existing) {
        return reply.code(409).send({ error: 'entry already exists', code: 'DUPLICATE' });
      }
      await ctx.db.insert(rewardWhitelist).values({
        id,
        kind: parsed.data.kind,
        value: normalizedValue,
        integratorId: parsed.data.integratorId ?? null,
        bonusPercent: parsed.data.bonusPercent ?? null,
        exactAmountNim: parsed.data.exactAmountNim ?? null,
        reason: parsed.data.reason ?? null,
        createdAt: new Date(),
      });
      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'reward-whitelist.add',
        target: id,
        signals: {
          kind: parsed.data.kind,
          value: normalizedValue,
          integratorId: parsed.data.integratorId ?? null,
          bonusPercent: parsed.data.bonusPercent ?? null,
          exactAmountNim: parsed.data.exactAmountNim ?? null,
        },
      });
      return reply.code(201).send({ id });
    },
  );

  app.delete(
    '/admin/reward-whitelist/:id',
    { bodyLimit: 32 * 1024, preHandler: requireAdminCsrf(ctx) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await ctx.db
        .select()
        .from(rewardWhitelist)
        .where(eq(rewardWhitelist.id, id))
        .limit(1);
      if (!row) return reply.code(404).send({ error: 'not found', code: 'NOT_FOUND' });
      await ctx.db.delete(rewardWhitelist).where(eq(rewardWhitelist.id, id));
      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'reward-whitelist.remove',
        target: id,
        signals: { kind: row.kind, value: row.value },
      });
      return reply.send({ ok: true });
    },
  );
}
