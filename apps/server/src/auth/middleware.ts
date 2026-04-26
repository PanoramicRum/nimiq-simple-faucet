/**
 * Fastify preHandler hooks for the admin API.
 *
 *   requireAdminSession  — validates the `faucet_session` cookie.
 *   requireAdminCsrf     — double-submit cookie/header for mutating methods.
 *   requireTotpStepUp    — fresh TOTP within `adminTotpStepUpTtlMs`.
 *
 * Nothing in these hooks logs token, cookie, TOTP, or CSRF values.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { adminUsers } from '../db/schema.js';
import { validateSession, verifyTotp } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    adminUser?: { id: string; sessionToken: string } | undefined;
  }
}

// Audit finding #017 / issue #97: bind admin cookies to the host using
// the `__Host-` prefix in non-dev mode. The prefix is enforced by the
// browser: a cookie named `__Host-…` is rejected unless `Secure` is set,
// `Path=/` is set, and no `Domain` attribute is present. That closes
// the subdomain-cookie-injection vector (a malicious sibling subdomain
// can set/overwrite cookies on the parent host without the prefix).
//
// The dev profile cannot use the prefix because dev runs over plain
// HTTP (Secure=false), so we conditionally pick the name based on the
// runtime `dev` flag. The dashboard reads the prefixed name first and
// falls back to the unprefixed for dev (apps/dashboard/src/lib/cookie.ts).
const SESSION_COOKIE_BASE = 'faucet_session';
const CSRF_COOKIE_BASE = 'faucet_csrf';
export const ADMIN_CSRF_HEADER = 'x-faucet-csrf';
export const ADMIN_TOTP_HEADER = 'x-faucet-totp';

export function adminSessionCookieName(dev: boolean): string {
  return dev ? SESSION_COOKIE_BASE : `__Host-${SESSION_COOKIE_BASE}`;
}
export function adminCsrfCookieName(dev: boolean): string {
  return dev ? CSRF_COOKIE_BASE : `__Host-${CSRF_COOKIE_BASE}`;
}

// Legacy unprefixed names — kept as aliases that mcp/auth.ts can still
// import without churning every callsite. Prefer the *Name(dev) helpers
// above when you have access to the runtime config.
export const ADMIN_SESSION_COOKIE = SESSION_COOKIE_BASE;
export const ADMIN_CSRF_COOKIE = CSRF_COOKIE_BASE;

function getCookie(req: FastifyRequest, name: string): string | undefined {
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> }).cookies;
  return cookies?.[name];
}

export function requireAdminSession(ctx: AppContext) {
  const cookieName = adminSessionCookieName(ctx.config.dev);
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = getCookie(req, cookieName);
    if (!token) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    const session = await validateSession(ctx.db, token);
    if (!session) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    req.adminUser = { id: session.userId, sessionToken: token };
  };
}

/**
 * Double-submit cookie: mutating methods must include the cookie value also
 * in an `X-Faucet-Csrf` header. Timing-safe compare.
 *
 * Factory form so it can pick the correct cookie name from `ctx.config.dev`
 * (`__Host-faucet_csrf` in production, `faucet_csrf` in dev).
 */
export function requireAdminCsrf(ctx: AppContext) {
  const cookieName = adminCsrfCookieName(ctx.config.dev);
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    const cookie = getCookie(req, cookieName);
    const header = req.headers[ADMIN_CSRF_HEADER];
    const headerStr = Array.isArray(header) ? header[0] : header;
    if (!cookie || !headerStr || typeof headerStr !== 'string') {
      await reply.code(403).send({ error: 'csrf token missing' });
      return;
    }
    const a = Buffer.from(cookie);
    const b = Buffer.from(headerStr);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      await reply.code(403).send({ error: 'csrf token mismatch' });
      return;
    }
  };
}

/**
 * TOTP step-up: either a fresh code in `X-Faucet-Totp`, OR a recorded
 * step-up timestamp within the configured TTL on this session.
 */
export function requireTotpStepUp(ctx: AppContext) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.adminUser) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    const [user] = await ctx.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, req.adminUser.id))
      .limit(1);
    if (!user?.totpSecret) {
      await reply.code(403).send({ error: 'totp not enrolled' });
      return;
    }
    const header = req.headers[ADMIN_TOTP_HEADER];
    const code = Array.isArray(header) ? header[0] : header;
    if (!code || typeof code !== 'string') {
      await reply.code(403).send({ error: 'totp step-up required' });
      return;
    }
    if (!verifyTotp(user.totpSecret, code)) {
      await reply.code(403).send({ error: 'invalid totp' });
      return;
    }
    // Caller route may choose to mark the session step-up afterwards.
  };
}
