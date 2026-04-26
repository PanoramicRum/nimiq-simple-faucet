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
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
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
  adminCsrfCookieName,
  adminSessionCookieName,
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

/**
 * Constant-time UTF-8 string compare. Used on the first-login seed branch
 * where the submitted password is matched against the env-configured
 * `FAUCET_ADMIN_PASSWORD`. `===` / `!==` on V8 short-circuit on length and
 * on the first differing character, which leaks a prefix-timing oracle
 * over the network (audit finding #003, issue #89).
 */
function safeEqualUtf8(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// Shared schema — single source of truth with OpenAPI spec.
import { LoginRequest as LoginBody } from '../../openapi/schemas.js';

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
        if (!safeEqualUtf8(password, ctx.config.adminPassword)) {
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
      // Unified error for all TOTP failures — prevents authentication
      // enumeration where distinct messages reveal password correctness
      // or TOTP enrolment status (#55).
      if (existing.totpSecret && (!totp || !verifyTotp(existing.totpSecret, totp))) {
        return reply.code(401).send({ error: 'invalid credentials' });
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
    const token = cookies?.[adminSessionCookieName(ctx.config.dev)];
    if (token) {
      await revokeSession(ctx.db, token);
    }
    clearAuthCookies(reply, ctx.config.dev);
    return reply.code(200).send({ ok: true });
  });

  // Dev-only: wipe per-instance state so e2e tests start from a pristine DB.
  // Gated on FAUCET_DEV=1 AND requires FAUCET_ADMIN_PASSWORD in the body
  // so it's not exploitable without knowing the configured password.
  app.post('/admin/auth/reset', async (req, reply) => {
    if (!ctx.config.dev) {
      return reply.code(404).send({ error: 'not found' });
    }
    const body = req.body as { password?: string } | null;
    if (!body?.password || body.password !== ctx.config.adminPassword) {
      return reply.code(401).send({ error: 'password required' });
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
  // Admin session cookie — HttpOnly + SameSite=strict + (in prod) `__Host-`
  // prefix. The prefix forces Path=/, so the cookie *is* sent to /v1/*,
  // but /v1/* never reads `req.adminUser` so this has no auth effect.
  // The original Path=/admin scoping is dropped because `__Host-` cannot
  // coexist with a non-root Path (see audit finding #017 / issue #97).
  reply.setCookie(adminSessionCookieName(dev), token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure,
  });
  // Double-submit CSRF token — readable by the dashboard JS.
  const csrf = randomBytes(24).toString('base64url');
  reply.setCookie(adminCsrfCookieName(dev), csrf, {
    path: '/',
    httpOnly: false,
    sameSite: 'strict',
    secure,
  });
}

function clearAuthCookies(reply: import('fastify').FastifyReply, dev: boolean): void {
  const secure = !dev;
  reply.clearCookie(adminSessionCookieName(dev), {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure,
  });
  reply.clearCookie(adminCsrfCookieName(dev), {
    path: '/',
    httpOnly: false,
    sameSite: 'strict',
    secure,
  });
}
