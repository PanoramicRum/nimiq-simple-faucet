/**
 * Admin session auth.
 *
 *   POST /admin/auth/login         password (+ totp if enrolled) → session
 *   POST /admin/auth/logout        revoke session
 *   POST /admin/auth/totp/enroll   pre-enrolment only (409 after)
 *
 * First-login flow: if no admin row exists and `FAUCET_ADMIN_PASSWORD` is
 * configured, the first valid password seeds an admin user. If
 * `FAUCET_ADMIN_TOTP_SECRET` is unset at seed time we generate one, persist
 * it, and return the provisioning URI in the response ONCE. Subsequent logins
 * require the TOTP and do not reveal the secret.
 *
 * Rate limit: 5 requests/min/IP on /admin/auth/login (applied at registration
 * time via @fastify/rate-limit's per-route config).
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import {
  adminUsers,
  adminSessions,
  auditLog,
  claims,
  fingerprintLinks,
  ipCounters,
} from '../../db/schema.js';
import {
  ADMIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
} from '../../auth/middleware.js';
import {
  hashPassword,
  issueSession,
  markSessionTotpStepUp,
  revokeSession,
  totpSecret as genTotpSecret,
  totpUri,
  verifyPassword,
  verifyTotp,
} from '../../auth/session.js';
import { writeAudit } from '../../auth/audit.js';

const ADMIN_USER_ID = 'admin';

const LoginBody = z.object({
  password: z.string().min(1).max(512),
  totp: z.string().min(1).max(16).optional(),
});

export async function adminAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post(
    '/admin/auth/login',
    {
      bodyLimit: 32 * 1024,
      config: {
        rateLimit: { max: ctx.config.adminLoginRatePerMinute, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const parsed = LoginBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid body' });
      }
      const { password, totp } = parsed.data;

      const [existing] = await ctx.db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.id, ADMIN_USER_ID))
        .limit(1);

      // First-login seeding.
      if (!existing) {
        if (!ctx.config.adminPassword) {
          return reply.code(403).send({ error: 'admin not configured' });
        }
        if (password !== ctx.config.adminPassword) {
          return reply.code(401).send({ error: 'invalid credentials' });
        }
        const { hash, salt } = await hashPassword(password);
        const secret = ctx.config.adminTotpSecret || genTotpSecret();
        await ctx.db.insert(adminUsers).values({
          id: ADMIN_USER_ID,
          passwordHash: hash,
          passwordSalt: salt,
          totpSecret: secret,
          createdAt: new Date(),
        });
        const { token, expiresAt } = await issueSession(
          ctx.db,
          ADMIN_USER_ID,
          ctx.config.adminSessionTtlMs,
        );
        setAuthCookies(reply, token, ctx.config.dev);
        await writeAudit(ctx.db, {
          actor: ADMIN_USER_ID,
          action: 'auth.login.seed',
          target: 'admin',
          signals: { ip: req.ip },
        });
        // Always reveal the provisioning URI on the initial seed — even when
        // the secret came from `FAUCET_ADMIN_TOTP_SECRET`, the operator still
        // needs a QR/URI to enroll their authenticator on the first run.
        return reply.code(200).send({
          ok: true,
          expiresAt: expiresAt.toISOString(),
          totpProvisioningUri: totpUri(secret, 'admin'),
          totpSecret: secret,
        });
      }

      // Subsequent logins: password + TOTP (if enrolled).
      const ok = await verifyPassword(password, existing.passwordHash, existing.passwordSalt);
      if (!ok) {
        return reply.code(401).send({ error: 'invalid credentials' });
      }
      if (existing.totpSecret) {
        if (!totp) {
          return reply.code(401).send({ error: 'totp required' });
        }
        if (!verifyTotp(existing.totpSecret, totp)) {
          return reply.code(401).send({ error: 'invalid totp' });
        }
      }
      const { token, expiresAt } = await issueSession(
        ctx.db,
        existing.id,
        ctx.config.adminSessionTtlMs,
      );
      if (existing.totpSecret && totp) {
        await markSessionTotpStepUp(ctx.db, token, new Date());
      }
      setAuthCookies(reply, token, ctx.config.dev);
      await writeAudit(ctx.db, {
        actor: existing.id,
        action: 'auth.login',
        target: 'admin',
        signals: { ip: req.ip },
      });
      return reply.code(200).send({ ok: true, expiresAt: expiresAt.toISOString() });
    },
  );

  app.post('/admin/auth/logout', async (req, reply) => {
    const cookies = (req as { cookies?: Record<string, string | undefined> }).cookies;
    const token = cookies?.[ADMIN_SESSION_COOKIE];
    if (token) {
      await revokeSession(ctx.db, token);
    }
    clearAuthCookies(reply, ctx.config.dev);
    return reply.code(200).send({ ok: true });
  });

  // Test-only: wipe admin + per-IP counters + fingerprint links + claims +
  // audit log so a fresh browser-project run sees pristine state. Gated on
  // dev mode; 404 in prod so it never becomes a production foot-gun.
  app.post('/admin/auth/reset', async (_req, reply) => {
    if (!ctx.config.dev) {
      return reply.code(404).send({ error: 'not found' });
    }
    await ctx.db.delete(adminSessions);
    await ctx.db.delete(adminUsers);
    await ctx.db.delete(ipCounters);
    await ctx.db.delete(fingerprintLinks);
    await ctx.db.delete(claims);
    await ctx.db.delete(auditLog);
    return reply.code(200).send({ ok: true });
  });

  // Pre-enrolment TOTP provisioning. Only usable if no admin row exists yet.
  app.post('/admin/auth/totp/enroll', async (_req, reply) => {
    const [existing] = await ctx.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, ADMIN_USER_ID))
      .limit(1);
    if (existing) {
      return reply.code(409).send({ error: 'already enrolled' });
    }
    const secret = genTotpSecret();
    return reply
      .code(200)
      .send({ secret, provisioningUri: totpUri(secret, 'admin') });
  });
}

function setAuthCookies(
  reply: import('fastify').FastifyReply,
  token: string,
  dev: boolean,
): void {
  const secure = !dev;
  // Admin session cookie — HttpOnly, Path=/admin so it isn't sent on /v1/*.
  reply.setCookie(ADMIN_SESSION_COOKIE, token, {
    path: '/admin',
    httpOnly: true,
    sameSite: 'strict',
    secure,
  });
  // Double-submit CSRF token — readable by the dashboard JS.
  const csrf = randomBytes(24).toString('base64url');
  reply.setCookie(ADMIN_CSRF_COOKIE, csrf, {
    path: '/',
    httpOnly: false,
    sameSite: 'strict',
    secure,
  });
}

function clearAuthCookies(reply: import('fastify').FastifyReply, dev: boolean): void {
  const secure = !dev;
  reply.clearCookie(ADMIN_SESSION_COOKIE, { path: '/admin', httpOnly: true, sameSite: 'strict', secure });
  reply.clearCookie(ADMIN_CSRF_COOKIE, { path: '/', httpOnly: false, sameSite: 'strict', secure });
}
