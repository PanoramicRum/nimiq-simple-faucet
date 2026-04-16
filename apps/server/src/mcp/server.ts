/**
 * MCP server surface for the Nimiq Simple Faucet.
 *
 * Milestone M7.3. Public tools are unauthenticated; admin-scoped tools go
 * through {@link requireAdminToken}. The real admin-session integration lands
 * in M3 (see plan `/home/richy/.claude/plans/starry-roaming-bunny.md`).
 *
 * The admin guard currently accepts a single shared secret via
 * `FAUCET_ADMIN_MCP_TOKEN`. TODO(M3): replace with the full admin-session
 * machinery (short-lived tokens, revocation, audit log).
 */
import { timingSafeEqual } from 'node:crypto';
import { desc, eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { blocklist, claims } from '../db/schema.js';
import type { AppContext } from '../context.js';

/** Names of tools that require the admin token. */
export const ADMIN_TOOLS: ReadonlySet<string> = new Set([
  'faucet.balance',
  'faucet.send',
  'faucet.block_address',
  'faucet.unblock_address',
  'faucet.list_blocks',
  'faucet.explain_decision',
]);

/** Names of tools that are publicly callable. */
export const PUBLIC_TOOLS: ReadonlySet<string> = new Set([
  'faucet.status',
  'faucet.recent_claims',
  'faucet.stats',
]);

/** All registered tool names, in stable order. */
export const ALL_TOOLS: readonly string[] = [
  'faucet.status',
  'faucet.recent_claims',
  'faucet.stats',
  'faucet.balance',
  'faucet.send',
  'faucet.block_address',
  'faucet.unblock_address',
  'faucet.list_blocks',
  'faucet.explain_decision',
];

const BLOCK_KINDS = ['ip', 'address', 'uid', 'asn', 'country'] as const;

/**
 * Enforces the admin-token policy. Throws a plain `Error` so the SDK surfaces
 * it as a tool-call error to the client. Uses timing-safe comparison.
 *
 * TODO(M3): swap for real admin sessions — see plan M3.
 */
export function requireAdminToken(
  tools: ReadonlySet<string>,
  toolName: string,
  providedToken: string | undefined,
  configuredToken: string | undefined,
): void {
  if (!tools.has(toolName)) return;
  if (!configuredToken) {
    throw new Error('Admin MCP not configured: set FAUCET_ADMIN_MCP_TOKEN');
  }
  if (!providedToken) throw new Error('Admin MCP token missing');
  const a = Buffer.from(providedToken);
  const b = Buffer.from(configuredToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Admin MCP token invalid');
  }
}

export interface BuildMcpServerOptions {
  /** Resolves the per-request admin token from the incoming HTTP headers. */
  getAdminToken?: () => string | undefined;
  /** The configured admin token (typically `process.env.FAUCET_ADMIN_MCP_TOKEN`). */
  configuredAdminToken?: string | undefined;
}

/**
 * Builds a configured {@link McpServer} exposing the faucet tools & resources.
 *
 * The server is transport-agnostic; `index.ts` wires it to a per-request
 * `StreamableHTTPServerTransport`.
 */
export function buildMcpServer(ctx: AppContext, opts: BuildMcpServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'nimiq-faucet', version: '0.0.1' },
    { capabilities: { tools: {}, resources: {} } },
  );

  const guard = (toolName: string): void => {
    requireAdminToken(
      ADMIN_TOOLS,
      toolName,
      opts.getAdminToken?.(),
      opts.configuredAdminToken,
    );
  };

  const ok = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  });

  // ---- Public tools -----------------------------------------------------

  server.registerTool(
    'faucet.status',
    {
      description: 'Fetch a single claim by id. Public.',
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const [row] = await ctx.db.select().from(claims).where(eq(claims.id, id)).limit(1);
      if (!row) return ok({ error: 'not found', id });
      return ok({
        id: row.id,
        status: row.status,
        address: row.address,
        amountLuna: row.amountLuna,
        txId: row.txId,
        createdAt: row.createdAt,
        decision: row.decision,
        rejectionReason: row.rejectionReason,
      });
    },
  );

  server.registerTool(
    'faucet.recent_claims',
    {
      description:
        'List recent claims, omitting IP and user-agent for PII hygiene. Includes decision + signals.',
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    },
    async ({ limit }) => {
      const n = limit ?? 20;
      const rows = await ctx.db
        .select({
          id: claims.id,
          createdAt: claims.createdAt,
          address: claims.address,
          amountLuna: claims.amountLuna,
          status: claims.status,
          txId: claims.txId,
          decision: claims.decision,
          abuseScore: claims.abuseScore,
          signalsJson: claims.signalsJson,
          integratorId: claims.integratorId,
        })
        .from(claims)
        .orderBy(desc(claims.createdAt))
        .limit(n);
      return ok(
        rows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          address: r.address,
          amountLuna: r.amountLuna,
          status: r.status,
          txId: r.txId,
          decision: r.decision,
          abuseScore: r.abuseScore,
          signals: safeParseJson(r.signalsJson),
          integratorId: r.integratorId,
        })),
      );
    },
  );

  server.registerTool(
    'faucet.stats',
    {
      description: 'Aggregate stats across the most recent 100 claims. Public.',
      inputSchema: {},
    },
    async () => {
      const recent = await ctx.db
        .select({
          status: claims.status,
          decision: claims.decision,
        })
        .from(claims)
        .limit(100);
      return ok({
        total: recent.length,
        byStatus: groupBy(recent.map((r) => r.status)),
        byDecision: groupBy(recent.map((r) => r.decision)),
      });
    },
  );

  // ---- Admin-scoped tools ----------------------------------------------

  server.registerTool(
    'faucet.balance',
    {
      description: 'Faucet wallet balance in Luna (decimal string). Admin-scoped.',
      inputSchema: {},
    },
    async () => {
      guard('faucet.balance');
      const balance = await ctx.driver.getBalance();
      return ok({ balanceLuna: balance.toString() });
    },
  );

  server.registerTool(
    'faucet.send',
    {
      description: 'Send Luna out of the faucet wallet. Admin-scoped.',
      inputSchema: {
        to: z.string().min(1),
        amountLuna: z.string().regex(/^[0-9]+$/, 'amountLuna must be a decimal integer string'),
      },
    },
    async ({ to, amountLuna }) => {
      guard('faucet.send');
      const parsed = ctx.driver.parseAddress(to);
      const txId = await ctx.driver.send(parsed, BigInt(amountLuna));
      return ok({ txId, to: parsed, amountLuna });
    },
  );

  server.registerTool(
    'faucet.block_address',
    {
      description: 'Add an entry to the blocklist. Admin-scoped.',
      inputSchema: {
        kind: z.enum(BLOCK_KINDS),
        value: z.string().min(1),
        reason: z.string().optional(),
        expiresAt: z.number().int().positive().optional(),
      },
    },
    async ({ kind, value, reason, expiresAt }) => {
      guard('faucet.block_address');
      const id = nanoid();
      await ctx.db.insert(blocklist).values({
        id,
        kind,
        value,
        reason: reason ?? null,
        expiresAt: expiresAt !== undefined ? new Date(expiresAt) : null,
      });
      return ok({ id, kind, value });
    },
  );

  server.registerTool(
    'faucet.unblock_address',
    {
      description: 'Remove blocklist entries matching (kind, value). Admin-scoped.',
      inputSchema: {
        kind: z.enum(BLOCK_KINDS),
        value: z.string().min(1),
      },
    },
    async ({ kind, value }) => {
      guard('faucet.unblock_address');
      await ctx.db
        .delete(blocklist)
        .where(and(eq(blocklist.kind, kind), eq(blocklist.value, value)));
      return ok({ removed: { kind, value } });
    },
  );

  server.registerTool(
    'faucet.list_blocks',
    {
      description: 'Enumerate blocklist entries, newest first. Admin-scoped.',
      inputSchema: { limit: z.number().int().min(1).max(1000).optional() },
    },
    async ({ limit }) => {
      guard('faucet.list_blocks');
      const rows = await ctx.db
        .select()
        .from(blocklist)
        .orderBy(desc(blocklist.createdAt))
        .limit(limit ?? 100);
      return ok(rows);
    },
  );

  server.registerTool(
    'faucet.explain_decision',
    {
      description: 'Return the structured abuse signals JSON for a claim. Admin-scoped.',
      inputSchema: { claimId: z.string().min(1) },
    },
    async ({ claimId }) => {
      guard('faucet.explain_decision');
      const [row] = await ctx.db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
      if (!row) return ok({ error: 'not found', claimId });
      return ok({
        id: row.id,
        decision: row.decision,
        abuseScore: row.abuseScore,
        rejectionReason: row.rejectionReason,
        signals: safeParseJson(row.signalsJson),
      });
    },
  );

  // ---- Resources --------------------------------------------------------

  server.registerResource(
    'faucet-config',
    'faucet://config',
    {
      description: 'Public faucet configuration (mirrors GET /v1/config).',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'application/json',
          text: JSON.stringify(buildPublicConfig(ctx)),
        },
      ],
    }),
  );

  server.registerResource(
    'faucet-openapi',
    'faucet://openapi.json',
    {
      description: 'OpenAPI spec placeholder.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'application/json',
          text: JSON.stringify({ note: 'OpenAPI spec generation lands in M7.1' }),
        },
      ],
    }),
  );

  server.registerResource(
    'faucet-recent-claims',
    'faucet://recent-claims',
    {
      description: 'Last 50 claims (PII-sanitized: no IP, no user-agent).',
      mimeType: 'application/json',
    },
    async (uri) => {
      const rows = await ctx.db
        .select({
          id: claims.id,
          createdAt: claims.createdAt,
          address: claims.address,
          amountLuna: claims.amountLuna,
          status: claims.status,
          txId: claims.txId,
          decision: claims.decision,
          abuseScore: claims.abuseScore,
        })
        .from(claims)
        .orderBy(desc(claims.createdAt))
        .limit(50);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify(rows),
          },
        ],
      };
    },
  );

  return server;
}

function groupBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildPublicConfig(ctx: AppContext): Record<string, unknown> {
  const c = ctx.config;
  const captcha = c.turnstileSiteKey
    ? { provider: 'turnstile' as const, siteKey: c.turnstileSiteKey }
    : c.hcaptchaSiteKey
      ? { provider: 'hcaptcha' as const, siteKey: c.hcaptchaSiteKey }
      : null;
  return {
    network: c.network,
    claimAmountLuna: c.claimAmountLuna.toString(),
    abuseLayers: {
      turnstile: !!c.turnstileSiteKey,
      hcaptcha: !!c.hcaptchaSiteKey,
      hashcash: !!c.hashcashSecret,
      geoip: c.geoipBackend !== 'none',
      ai: false,
    },
    captcha,
    hashcash: c.hashcashSecret
      ? { difficulty: c.hashcashDifficulty, ttlMs: c.hashcashTtlMs }
      : null,
  };
}
