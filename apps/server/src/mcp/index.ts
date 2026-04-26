/**
 * Fastify plugin wiring the MCP server into the faucet app.
 *
 * Exposes:
 *   - `POST /mcp` — streamable HTTP transport (JSON-RPC over HTTP/SSE).
 *   - `GET  /mcp` — lightweight discovery: name, version, tool catalogue.
 *
 * Admin authentication (two paths, tried in order):
 *
 *   1. **Admin session + TOTP step-up** (preferred, #88). Client sends the
 *      `faucet_session` cookie obtained from `/admin/auth/login`. Session
 *      must have a TOTP step-up within `adminTotpStepUpTtlMs`.
 *   2. **Static `FAUCET_ADMIN_MCP_TOKEN`** (deprecated fallback). Sent via
 *      the `x-faucet-admin-token` header. Only honoured when
 *      `FAUCET_ADMIN_MCP_ALLOW_STATIC_TOKEN=true`. Kept so existing
 *      deployments don't break when bumping to this version; operators
 *      should migrate to the session path and flip the flag to `false`.
 *
 * Per-request rate-limit: `adminLoginRatePerMinute` / minute / IP (same
 * bucket as `/admin/auth/login`). Every admin tool call is written to the
 * audit log naming the resolved principal (`session:<userId>` or
 * `static-token`). Public tools are unauthenticated and unaudited.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppContext } from '../context.js';
import { adminUsers } from '../db/schema.js';
import {
  ADMIN_TOTP_HEADER,
  adminSessionCookieName,
} from '../auth/middleware.js';
import { validateSession, verifyTotp, markSessionTotpStepUp } from '../auth/session.js';
import { ALL_TOOLS, ADMIN_TOOLS, buildMcpServer, type AdminPrincipal } from './server.js';

/** Header used to pass the deprecated static admin token. */
export const ADMIN_TOKEN_HEADER = 'x-faucet-admin-token';

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Resolve the admin principal for an MCP request, if any. Tries session
 * first, falls back to the deprecated static token. Returns `null` when no
 * admin auth was presented / verified — admin tool calls then fail at the
 * per-tool guard in {@link buildMcpServer}.
 *
 * Exported for unit testing. The transport plumbing around it is thin.
 */
export async function resolveAdminPrincipal(
  ctx: AppContext,
  req: FastifyRequest,
): Promise<AdminPrincipal | null> {
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> })
    .cookies;
  const sessionToken = cookies?.[adminSessionCookieName(ctx.config.dev)];
  if (sessionToken) {
    const session = await validateSession(ctx.db, sessionToken);
    if (session) {
      // Require a fresh TOTP step-up either on the session row or supplied
      // as `x-faucet-totp` in this request, matching the /admin/* policy.
      const stepUpTtlMs = ctx.config.adminTotpStepUpTtlMs;
      const now = Date.now();
      const recent =
        session.totpStepUpAt && now - session.totpStepUpAt.getTime() <= stepUpTtlMs;
      if (recent) {
        return { kind: 'session', userId: session.userId };
      }
      const header = req.headers[ADMIN_TOTP_HEADER];
      const code = Array.isArray(header) ? header[0] : header;
      if (code && typeof code === 'string') {
        const [user] = await ctx.db
          .select()
          .from(adminUsers)
          .where(eq(adminUsers.id, session.userId))
          .limit(1);
        if (user?.totpSecret && verifyTotp(user.totpSecret, code)) {
          await markSessionTotpStepUp(ctx.db, sessionToken);
          return { kind: 'session', userId: session.userId };
        }
      }
      // Session present but no valid step-up → intentionally falls through
      // to the static-token path (or denial) rather than auto-accepting.
    }
  }

  if (ctx.config.adminMcpAllowStaticToken && ctx.config.adminMcpToken) {
    const headerValue = req.headers[ADMIN_TOKEN_HEADER];
    const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (provided && constantTimeEqual(provided, ctx.config.adminMcpToken)) {
      return { kind: 'static-token' };
    }
  }
  return null;
}

export async function mcpRoute(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/mcp', async () => ({
    name: 'nimiq-faucet',
    version: '0.0.1',
    transport: 'streamable-http',
    tools: ALL_TOOLS.map((name) => ({
      name,
      admin: ADMIN_TOOLS.has(name),
    })),
  }));

  app.post(
    '/mcp',
    {
      config: {
        rateLimit: { max: ctx.config.adminLoginRatePerMinute, timeWindow: '1 minute' },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const principal = await resolveAdminPrincipal(ctx, req);

      const server = buildMcpServer(ctx, {
        getAdminPrincipal: () => principal,
      });

      // Stateless: one transport per request, no session IDs. The SDK's type
      // signature marks `sessionIdGenerator` as `() => string`, but the runtime
      // treats `undefined` as the stateless sentinel — see the SDK JSDoc.
      const transport = new StreamableHTTPServerTransport(
        { sessionIdGenerator: undefined } as unknown as ConstructorParameters<
          typeof StreamableHTTPServerTransport
        >[0],
      );

      reply.raw.on('close', () => {
        void transport.close();
        void server.close();
      });

      // Hand the raw socket to the MCP transport. Fastify must not try to
      // serialize a response on top of it.
      reply.hijack();
      await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    },
  );
}
