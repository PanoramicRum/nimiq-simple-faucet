/**
 * Admin plugin — registers all /admin/* routes behind session auth.
 *
 * Public routes (no auth): /admin/auth/login, /admin/auth/totp/enroll.
 * Everything else requires a valid `faucet_session` cookie.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { requireAdminSession } from '../../auth/middleware.js';
import { adminAuthRoutes } from './auth.js';
import { adminOverviewRoutes } from './overview.js';
import { adminClaimsRoutes } from './claims.js';
import { adminBlocklistRoutes } from './blocklist.js';
import { adminIntegratorsRoutes } from './integrators.js';
import { adminConfigRoutes } from './config.js';
import { adminAccountRoutes } from './account.js';
import { adminAuditRoutes } from './audit.js';

export async function adminRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Unauthenticated admin endpoints.
  await adminAuthRoutes(app, ctx);

  // Everything below requires a session. We gate via an onRequest hook that
  // only applies to /admin/* paths not on the public allow-list.
  const publicAdminPaths = new Set<string>([
    '/admin/auth/login',
    '/admin/auth/logout',
    '/admin/auth/totp/enroll',
  ]);
  const sessionGate = requireAdminSession(ctx);
  // Only the admin *API* prefixes are gated. Paths like /admin/login or
  // /admin/assets/*.js that belong to the dashboard SPA fall through to the
  // static handler without requiring a session.
  const gatedPrefixes = [
    '/admin/auth',
    '/admin/overview',
    '/admin/claims',
    '/admin/blocklist',
    '/admin/integrators',
    '/admin/config',
    '/admin/account',
    '/admin/audit',
    '/admin/audit-log',
  ];
  // Load the dashboard SPA shell once so we can short-circuit API paths that
  // collide with client-side routes (e.g. `/admin/claims`) when the browser is
  // navigating to them (Accept: text/html) rather than calling the JSON API.
  const dashIndex = findDashboardIndex(ctx.config.dashboardDir);
  app.addHook('onRequest', async (req, reply) => {
    const [path] = req.url.split('?');
    if (!path) return;
    const gated = gatedPrefixes.some((p) => path === p || path.startsWith(`${p}/`));
    if (!gated) return;
    if (publicAdminPaths.has(path)) return;
    const accept = req.headers.accept ?? '';
    const isHtmlNav = typeof accept === 'string' && accept.includes('text/html');
    if (isHtmlNav && dashIndex) {
      // Browser navigation: serve the SPA shell instead of the JSON API so
      // the dashboard's client-side router can take over. The SPA fetches
      // data with explicit `Accept: application/json`, which still goes
      // through the session gate below.
      return reply.type('text/html').send(dashIndex);
    }
    await sessionGate(req, reply);
  });

  await adminOverviewRoutes(app, ctx);
  await adminClaimsRoutes(app, ctx);
  await adminBlocklistRoutes(app, ctx);
  await adminIntegratorsRoutes(app, ctx);
  await adminConfigRoutes(app, ctx);
  await adminAccountRoutes(app, ctx);
  await adminAuditRoutes(app, ctx);
}

function findDashboardIndex(configured?: string): Buffer | null {
  const candidates = [
    configured,
    resolve(process.cwd(), 'apps/dashboard/dist/index.html'),
    resolve(process.cwd(), '../dashboard/dist/index.html'),
    '/app/apps/dashboard/dist/index.html',
  ].filter((p): p is string => !!p);
  for (const c of candidates) {
    const path = c.endsWith('index.html') ? c : resolve(c, 'index.html');
    if (existsSync(path)) return readFileSync(path);
  }
  return null;
}
