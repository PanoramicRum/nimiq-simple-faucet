/**
 * MCP server surface for the Nimiq Simple Faucet.
 *
 * Public tools are unauthenticated; admin-scoped tools require an
 * {@link AdminPrincipal} resolved upstream by `apps/server/src/mcp/index.ts`
 * — either an admin-session + TOTP step-up (preferred) or the deprecated
 * static `FAUCET_ADMIN_MCP_TOKEN`. Every admin tool call is written to the
 * audit log naming the principal (#88).
 */
import { desc, eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeBlocklistValue } from '@faucet/core';
import { blocklist, claims, rewardWhitelist } from '../db/schema.js';
import type { AppContext } from '../context.js';
import { writeAudit } from '../auth/audit.js';
import {
  AdminSendRequest,
  BlocklistCreateRequest,
  RewardWhitelistCreateRequest,
} from '../openapi/schemas.js';

/** Identifies who invoked an admin-scoped MCP tool. */
export type AdminPrincipal =
  | { kind: 'session'; userId: string }
  | { kind: 'static-token' };

/** Names of tools that require the admin token. */
export const ADMIN_TOOLS: ReadonlySet<string> = new Set([
  'faucet.balance',
  'faucet.send',
  'faucet.block_address',
  'faucet.unblock_address',
  'faucet.list_blocks',
  'faucet.reward_whitelist_add',
  'faucet.reward_whitelist_remove',
  'faucet.reward_whitelist_list',
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
  'faucet.reward_whitelist_add',
  'faucet.reward_whitelist_remove',
  'faucet.reward_whitelist_list',
  'faucet.explain_decision',
];

// Block-kind enum is the source of truth in `openapi/schemas.ts`
// (`BlocklistCreateRequest.shape.kind`). MCP-tool schemas pick it via
// `.shape` so a new kind added on the REST side propagates here.

/**
 * Enforces the admin-principal policy for a tool call. Throws a plain `Error`
 * so the SDK surfaces it as a tool-call error to the client. The principal is
 * resolved upstream by the transport; this is a pure guard.
 */
export function requireAdminPrincipal(
  tools: ReadonlySet<string>,
  toolName: string,
  principal: AdminPrincipal | null,
): void {
  if (!tools.has(toolName)) return;
  if (!principal) throw new Error('Admin MCP auth required');
}

export interface BuildMcpServerOptions {
  /** Resolves the authenticated admin principal (if any) for this request. */
  getAdminPrincipal?: () => AdminPrincipal | null;
}

function principalLabel(p: AdminPrincipal): string {
  return p.kind === 'session' ? `session:${p.userId}` : 'static-token';
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

  const guard = async (toolName: string): Promise<void> => {
    const principal = opts.getAdminPrincipal?.() ?? null;
    requireAdminPrincipal(ADMIN_TOOLS, toolName, principal);
    if (principal) {
      await writeAudit(ctx.db, {
        actor: principalLabel(principal),
        action: `mcp.${toolName}`,
        target: toolName,
        signals: {},
      });
    }
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
      await guard('faucet.balance');
      const balance = await ctx.driver.getBalance();
      return ok({ balanceLuna: balance.toString() });
    },
  );

  server.registerTool(
    'faucet.send',
    {
      description: 'Send Luna out of the faucet wallet. Admin-scoped.',
      // `to` derived from `AdminSendRequest` (REST: POST /admin/account/send)
      // so address-validation changes propagate. `amountLuna` is intentionally
      // stricter than REST — MCP only accepts a decimal-integer string to
      // avoid JSON-number precision loss for large Luna amounts.
      inputSchema: {
        to: AdminSendRequest.shape.to,
        amountLuna: z.string().regex(/^[0-9]+$/, 'amountLuna must be a decimal integer string'),
      },
    },
    async ({ to, amountLuna }) => {
      await guard('faucet.send');
      const parsed = ctx.driver.parseAddress(to);
      const txId = await ctx.driver.send(parsed, BigInt(amountLuna));
      return ok({ txId, to: parsed, amountLuna });
    },
  );

  server.registerTool(
    'faucet.block_address',
    {
      description: 'Add an entry to the blocklist. Admin-scoped.',
      // Derived from `BlocklistCreateRequest` (REST: POST /admin/blocklist)
      // so the kind enum and length limits stay in sync.
      inputSchema: BlocklistCreateRequest.shape,
    },
    async ({ kind, value, reason, expiresAt }) => {
      await guard('faucet.block_address');
      const id = nanoid();
      // Canonicalise like the REST POST does (#94) — previously this tool
      // inserted the raw value, so an MCP-added `nq07…` entry never matched.
      const normalizedValue = normalizeBlocklistValue(kind, value);
      await ctx.db.insert(blocklist).values({
        id,
        kind,
        value: normalizedValue,
        reason: reason ?? null,
        expiresAt: expiresAt !== undefined ? new Date(expiresAt) : null,
      });
      return ok({ id, kind, value: normalizedValue });
    },
  );

  server.registerTool(
    'faucet.unblock_address',
    {
      description: 'Remove blocklist entries matching (kind, value). Admin-scoped.',
      // Same kind+value pair as `BlocklistCreateRequest`; picked so the enum
      // and length limit don't drift from the canonical schema.
      inputSchema: BlocklistCreateRequest.pick({ kind: true, value: true }).shape,
    },
    async ({ kind, value }) => {
      await guard('faucet.unblock_address');
      // Same canonical form as the insert paths, so removal always matches.
      const normalizedValue = normalizeBlocklistValue(kind, value);
      await ctx.db
        .delete(blocklist)
        .where(and(eq(blocklist.kind, kind), eq(blocklist.value, normalizedValue)));
      return ok({ removed: { kind, value: normalizedValue } });
    },
  );

  server.registerTool(
    'faucet.list_blocks',
    {
      description: 'Enumerate blocklist entries, newest first. Admin-scoped.',
      inputSchema: { limit: z.number().int().min(1).max(1000).optional() },
    },
    async ({ limit }) => {
      await guard('faucet.list_blocks');
      const rows = await ctx.db
        .select()
        .from(blocklist)
        .orderBy(desc(blocklist.createdAt))
        .limit(limit ?? 100);
      return ok(rows);
    },
  );

  server.registerTool(
    'faucet.reward_whitelist_add',
    {
      description:
        'Add a reward-whitelist entry (§2.4.5): an allow-listed address/uid gets a bonus percent or exact payout in automatic reward mode. Admin-scoped.',
      // Derived from `RewardWhitelistCreateRequest` (REST: POST
      // /admin/reward-whitelist) so the kind enum and limits stay in sync.
      inputSchema: RewardWhitelistCreateRequest.shape,
    },
    async ({ kind, value, integratorId, bonusPercent, exactAmountNim, reason }) => {
      await guard('faucet.reward_whitelist_add');
      // Same cross-field rule as the REST route: uid grants are bound to an
      // integrator; address entries have no integrator dimension.
      if (kind === 'uid' && !integratorId) {
        return ok({ error: 'uid entries require integratorId', kind, value });
      }
      if (kind === 'address' && integratorId) {
        return ok({ error: 'address entries must not set integratorId', kind, value });
      }
      const id = nanoid();
      const normalizedValue = normalizeBlocklistValue(kind, value);
      const [existing] = await ctx.db
        .select({ id: rewardWhitelist.id })
        .from(rewardWhitelist)
        .where(and(eq(rewardWhitelist.kind, kind), eq(rewardWhitelist.value, normalizedValue)))
        .limit(1);
      if (existing) return ok({ error: 'entry already exists', kind, value: normalizedValue });
      await ctx.db.insert(rewardWhitelist).values({
        id,
        kind,
        value: normalizedValue,
        integratorId: integratorId ?? null,
        bonusPercent: bonusPercent ?? null,
        exactAmountNim: exactAmountNim ?? null,
        reason: reason ?? null,
      });
      // Detailed audit row (the guard's generic mcp.* row carries no target
      // identity/amount) — mirrors the REST route's signals.
      await writeAudit(ctx.db, {
        actor: 'mcp',
        action: 'reward-whitelist.add',
        target: id,
        signals: {
          kind,
          value: normalizedValue,
          integratorId: integratorId ?? null,
          bonusPercent: bonusPercent ?? null,
          exactAmountNim: exactAmountNim ?? null,
        },
      });
      return ok({ id, kind, value: normalizedValue });
    },
  );

  server.registerTool(
    'faucet.reward_whitelist_remove',
    {
      description: 'Remove reward-whitelist entries matching (kind, value). Admin-scoped.',
      inputSchema: RewardWhitelistCreateRequest.pick({ kind: true, value: true }).shape,
    },
    async ({ kind, value }) => {
      await guard('faucet.reward_whitelist_remove');
      const normalizedValue = normalizeBlocklistValue(kind, value);
      await ctx.db
        .delete(rewardWhitelist)
        .where(and(eq(rewardWhitelist.kind, kind), eq(rewardWhitelist.value, normalizedValue)));
      await writeAudit(ctx.db, {
        actor: 'mcp',
        action: 'reward-whitelist.remove',
        target: `${kind}:${normalizedValue}`,
        signals: { kind, value: normalizedValue },
      });
      return ok({ removed: { kind, value: normalizedValue } });
    },
  );

  server.registerTool(
    'faucet.reward_whitelist_list',
    {
      description: 'Enumerate reward-whitelist entries, newest first. Admin-scoped.',
      inputSchema: { limit: z.number().int().min(1).max(1000).optional() },
    },
    async ({ limit }) => {
      await guard('faucet.reward_whitelist_list');
      const rows = await ctx.db
        .select()
        .from(rewardWhitelist)
        .orderBy(desc(rewardWhitelist.createdAt))
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
      await guard('faucet.explain_decision');
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
