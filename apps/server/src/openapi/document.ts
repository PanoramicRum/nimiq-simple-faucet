/**
 * Build the OpenAPI 3.1 document from the central schema registry.
 *
 * We register each route path/method against `registry` then ask
 * @asteasolutions/zod-to-openapi to emit the final JSON. This keeps route
 * handler files untouched while preserving a single source of truth for the
 * wire schemas.
 */
import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import type { ServerConfig } from '../config.js';
import {
  AdminAccount,
  AdminConfigPatch,
  AdminConfigResponse,
  AdminSendRequest,
  AuditListResponse,
  BlocklistCreateRequest,
  BlocklistEntry,
  ChallengeRequest,
  ClaimListResponse,
  ClaimRequest,
  ClaimResponse,
  ClaimStatusResponse,
  ErrorResponse,
  FaucetConfig,
  HashcashChallenge,
  IntegratorCreateRequest,
  IntegratorCredential,
  IntegratorRecord,
  LoginRequest,
  LoginResponse,
  McpDiscoveryResponse,
  OkResponse,
  OverviewResponse,
  StatsResponse,
  registry,
} from './schemas.js';

const PKG_VERSION = '0.0.1';

const jsonContent = <T extends z.ZodTypeAny>(schema: T) => ({
  'application/json': { schema },
});

function registerRoutes(): void {
  // ---------- Public ----------
  registry.registerPath({
    method: 'get',
    path: '/v1/config',
    tags: ['Public'],
    summary: 'Public faucet config',
    description: 'Network, claim amount, enabled abuse layers, captcha site keys.',
    responses: {
      200: { description: 'Config snapshot', content: jsonContent(FaucetConfig) },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/challenge',
    tags: ['Public'],
    summary: 'Mint a hashcash challenge',
    description: 'Returns a fresh proof-of-work challenge bound to the caller IP.',
    request: { body: { content: jsonContent(ChallengeRequest) } },
    responses: {
      200: { description: 'Challenge', content: jsonContent(HashcashChallenge) },
      404: { description: 'Hashcash not enabled', content: jsonContent(ErrorResponse) },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/claim',
    tags: ['Public'],
    summary: 'Submit a faucet claim',
    description:
      'Evaluates the abuse pipeline and, on `allow`, broadcasts a transaction. Optional integrator HMAC headers are verified when `X-Faucet-Api-Key` is present.',
    security: [{}, { integratorHmac: [] }],
    request: { body: { content: jsonContent(ClaimRequest) } },
    responses: {
      200: { description: 'Broadcast', content: jsonContent(ClaimResponse) },
      202: { description: 'Challenge or review', content: jsonContent(ClaimResponse) },
      400: { description: 'Bad request', content: jsonContent(ErrorResponse) },
      401: { description: 'Integrator auth failed', content: jsonContent(ErrorResponse) },
      403: { description: 'Denied', content: jsonContent(ClaimResponse) },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/claim/{id}',
    tags: ['Public'],
    summary: 'Claim status by id',
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'Status', content: jsonContent(ClaimStatusResponse) },
      404: { description: 'Not found', content: jsonContent(ErrorResponse) },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/stats',
    tags: ['Public'],
    summary: 'Recent aggregate stats',
    responses: { 200: { description: 'Stats', content: jsonContent(StatsResponse) } },
  });

  // ---------- Admin ----------
  registry.registerPath({
    method: 'post',
    path: '/admin/auth/login',
    tags: ['Admin'],
    summary: 'Password (+ TOTP) login',
    request: { body: { content: jsonContent(LoginRequest) } },
    responses: {
      200: { description: 'Session issued', content: jsonContent(LoginResponse) },
      401: { description: 'Invalid credentials', content: jsonContent(ErrorResponse) },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/admin/auth/logout',
    tags: ['Admin'],
    summary: 'Revoke the current admin session',
    security: [{ adminSession: [] }],
    responses: { 200: { description: 'Logged out', content: jsonContent(OkResponse) } },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/overview',
    tags: ['Admin'],
    summary: 'Dashboard overview',
    security: [{ adminSession: [] }],
    responses: {
      200: { description: 'Overview', content: jsonContent(OverviewResponse) },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/claims',
    tags: ['Admin'],
    summary: 'List claims',
    security: [{ adminSession: [] }],
    request: {
      query: z.object({
        limit: z.coerce.number().int().optional(),
        offset: z.coerce.number().int().optional(),
        status: z.string().optional(),
        decision: z.string().optional(),
        address: z.string().optional(),
      }),
    },
    responses: { 200: { description: 'List', content: jsonContent(ClaimListResponse) } },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/blocklist',
    tags: ['Admin'],
    summary: 'List blocklist entries',
    security: [{ adminSession: [] }],
    responses: {
      200: {
        description: 'Entries',
        content: jsonContent(
          z.object({ total: z.number().int(), items: z.array(BlocklistEntry) }),
        ),
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/admin/blocklist',
    tags: ['Admin'],
    summary: 'Add a blocklist entry',
    security: [{ adminSession: [] }],
    request: { body: { content: jsonContent(BlocklistCreateRequest) } },
    responses: {
      201: { description: 'Created', content: jsonContent(z.object({ id: z.string() })) },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/integrators',
    tags: ['Admin'],
    summary: 'List integrator keys',
    security: [{ adminSession: [] }],
    responses: {
      200: {
        description: 'List',
        content: jsonContent(z.object({ items: z.array(IntegratorRecord) })),
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/admin/integrators',
    tags: ['Admin'],
    summary: 'Provision an integrator (one-time credential return)',
    security: [{ adminSession: [] }],
    request: { body: { content: jsonContent(IntegratorCreateRequest) } },
    responses: {
      201: { description: 'Created', content: jsonContent(IntegratorCredential) },
      409: { description: 'Exists', content: jsonContent(ErrorResponse) },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/config',
    tags: ['Admin'],
    summary: 'Effective config + overrides',
    security: [{ adminSession: [] }],
    responses: {
      200: { description: 'Config', content: jsonContent(AdminConfigResponse) },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/admin/config',
    tags: ['Admin'],
    summary: 'Persist runtime config overrides',
    description: 'NOTE(M3): persisted but not yet hot-reloaded into live traffic.',
    security: [{ adminSession: [] }],
    request: { body: { content: jsonContent(AdminConfigPatch) } },
    responses: { 200: { description: 'Persisted', content: jsonContent(OkResponse) } },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/account',
    tags: ['Admin'],
    summary: 'Faucet wallet account info',
    security: [{ adminSession: [] }],
    responses: { 200: { description: 'Account', content: jsonContent(AdminAccount) } },
  });

  registry.registerPath({
    method: 'post',
    path: '/admin/account/send',
    tags: ['Admin'],
    summary: 'Manual send (requires TOTP step-up)',
    security: [{ adminSession: [] }],
    request: { body: { content: jsonContent(AdminSendRequest) } },
    responses: {
      200: { description: 'Sent', content: jsonContent(z.object({ txId: z.string() })) },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/audit-log',
    tags: ['Admin'],
    summary: 'Admin audit log',
    security: [{ adminSession: [] }],
    responses: { 200: { description: 'Entries', content: jsonContent(AuditListResponse) } },
  });

  // ---------- MCP ----------
  registry.registerPath({
    method: 'get',
    path: '/mcp',
    tags: ['MCP'],
    summary: 'MCP discovery (tool catalogue)',
    responses: {
      200: { description: 'Discovery', content: jsonContent(McpDiscoveryResponse) },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/mcp',
    tags: ['MCP'],
    summary: 'MCP streamable HTTP transport (JSON-RPC)',
    description: 'Admin-scoped tools require `X-Faucet-Admin-Token`.',
    security: [{}, { adminMcpToken: [] }],
    responses: {
      200: { description: 'JSON-RPC response (stream)' },
    },
  });
}

let registered = false;

function registerOnce(): void {
  if (registered) return;
  registerRoutes();
  registry.registerComponent('securitySchemes', 'integratorHmac', {
    type: 'apiKey',
    in: 'header',
    name: 'X-Faucet-Api-Key',
    description:
      'Integrator HMAC auth: include `X-Faucet-Api-Key`, `X-Faucet-Timestamp`, `X-Faucet-Nonce`, and `X-Faucet-Signature` (base64-HMAC-SHA256 over `method\\npath\\ntimestamp\\nnonce\\nbodyHash`).',
  });
  registry.registerComponent('securitySchemes', 'adminSession', {
    type: 'apiKey',
    in: 'cookie',
    name: 'faucet_session',
    description:
      'Session cookie issued by POST /admin/auth/login. Mutating calls also require the `X-Faucet-Csrf` double-submit header matching the `faucet_csrf` cookie.',
  });
  registry.registerComponent('securitySchemes', 'adminMcpToken', {
    type: 'apiKey',
    in: 'header',
    name: 'X-Faucet-Admin-Token',
    description: 'Required to invoke admin-scoped MCP tools over POST /mcp.',
  });
  registered = true;
}

export function buildOpenapiDocument(config: ServerConfig): ReturnType<
  OpenApiGeneratorV31['generateDocument']
> {
  registerOnce();

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Nimiq Simple Faucet',
      version: PKG_VERSION,
      description: `Public, admin, and MCP surfaces for the Nimiq Simple Faucet${config.network === 'main' ? ' (mainnet)' : ' (testnet)'}. See /SECURITY.md for the threat model.`,
      license: { name: 'MIT', identifier: 'MIT' },
      contact: { name: 'Security', url: 'https://github.com/onmax/Nimiq-Simple-Faucet/blob/main/SECURITY.md' },
    },
    servers: [{ url: '/', description: 'This instance' }],
    tags: [
      { name: 'Public', description: 'Open endpoints (rate-limited).' },
      { name: 'Admin', description: 'Session-authenticated dashboard API.' },
      { name: 'MCP', description: 'Model Context Protocol transport + discovery.' },
    ],
  });
}
