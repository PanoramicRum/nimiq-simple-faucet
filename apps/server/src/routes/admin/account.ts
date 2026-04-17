import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { desc, isNotNull } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { claims } from '../../db/schema.js';
import { writeAudit } from '../../auth/audit.js';
import { requireAdminCsrf, requireTotpStepUp } from '../../auth/middleware.js';
import { writeKeyring } from '../../auth/keyring.js';
import { AdminSendRequest as SendBody } from '../../openapi/schemas.js';

export async function adminAccountRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/admin/account', async () => {
    let address = '';
    try {
      address = (await ctx.driver.getFaucetAddress?.()) ?? '';
    } catch {
      address = '';
    }
    let balance: string;
    try {
      balance = (await ctx.driver.getBalance()).toString();
    } catch {
      balance = '0';
    }
    const recentPayouts = await ctx.db
      .select()
      .from(claims)
      .where(isNotNull(claims.txId))
      .orderBy(desc(claims.createdAt))
      .limit(20);
    return {
      address,
      balance,
      recentPayouts: recentPayouts.map((r) => ({
        id: r.id,
        address: r.address,
        amountLuna: r.amountLuna,
        txId: r.txId,
        createdAt: r.createdAt,
        status: r.status,
      })),
    };
  });

  app.post(
    '/admin/account/send',
    { bodyLimit: 32 * 1024, preHandler: [requireAdminCsrf, requireTotpStepUp(ctx)] },
    async (req, reply) => {
      const parsed = SendBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
      const { to, amountLuna, memo } = parsed.data;
      let address: string;
      try {
        address = ctx.driver.parseAddress(to);
      } catch (err) {
        return reply.code(400).send({ error: 'invalid address', message: (err as Error).message });
      }
      const amount =
        typeof amountLuna === 'string' ? BigInt(amountLuna) : BigInt(amountLuna);
      const txId = await ctx.driver.send(address, amount);
      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'account.send',
        target: address,
        signals: { amountLuna: amount.toString(), txId, memo: memo ?? null },
      });
      return reply.send({ txId });
    },
  );

  app.post(
    '/admin/account/rotate-key',
    { bodyLimit: 32 * 1024, preHandler: [requireAdminCsrf, requireTotpStepUp(ctx)] },
    async (req, reply) => {
      // If the deployment uses an encrypted keyring, rotate the at-rest blob
      // by re-encrypting a freshly minted plaintext. For RPC signer setups
      // where the key is held externally we simply write an audit entry.
      const rotatedAt = new Date();
      if (ctx.config.keyPassphrase && ctx.config.keyringPath) {
        // A real driver would expose a rotate(). For M3 we regenerate a random
        // 32-byte plaintext for the keyring blob — the driver does not pick
        // it up at runtime (documented follow-up).
        const plaintext = generateRandomKeyHex();
        await writeKeyring(ctx.config.keyringPath, plaintext, ctx.config.keyPassphrase);
      }
      await writeAudit(ctx.db, {
        actor: req.adminUser?.id ?? 'admin',
        action: 'account.rotate_key',
        signals: { at: rotatedAt.toISOString() },
      });
      return reply.send({ rotatedAt: rotatedAt.toISOString() });
    },
  );
}

function generateRandomKeyHex(): string {
  // 32 random bytes hex-encoded. Never returned to the caller.
  return randomBytes(32).toString('hex');
}
