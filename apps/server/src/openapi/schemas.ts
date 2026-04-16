/**
 * Centralised Zod schemas used to generate the OpenAPI 3.1 document.
 *
 * We mirror the shapes already validated by the route handlers rather than
 * retrofit `fastify-type-provider-zod` across every route — that would require
 * heavier surgery. Keep these in sync when routes evolve.
 *
 * NOTE: Several /admin/* shapes below are minimal (e.g. audit `signals` is
 * `record(unknown)`); these will be tightened as the dashboard stabilises.
 */
import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Must run before any `.openapi()` calls on Zod schemas.
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ---------- Public: claim flow ----------

export const HostContextDTO = registry.register(
  'HostContext',
  z.object({
    uid: z.string().max(256).optional(),
    cookieHash: z.string().max(256).optional(),
    sessionHash: z.string().max(256).optional(),
    accountAgeDays: z.number().int().nonnegative().optional(),
    emailDomainHash: z.string().max(256).optional(),
    kycLevel: z.enum(['none', 'email', 'phone', 'id']).optional(),
    tags: z.array(z.string().max(64)).max(32).optional(),
    signature: z.string().max(512).optional(),
  }),
);

export const FingerprintDTO = registry.register(
  'Fingerprint',
  z.object({
    visitorId: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    components: z.record(z.unknown()).optional(),
  }),
);

export const ClaimRequest = registry.register(
  'ClaimRequest',
  z.object({
    address: z.string().min(1).describe('Target address in native chain format'),
    captchaToken: z.string().optional(),
    hashcashSolution: z.string().optional(),
    powSolution: z.string().optional().describe('Deprecated alias for hashcashSolution'),
    fingerprint: FingerprintDTO.optional(),
    hostContext: HostContextDTO.optional(),
  }),
);

export const ClaimResponse = registry.register(
  'ClaimResponse',
  z.object({
    id: z.string(),
    status: z.enum(['broadcast', 'confirmed', 'rejected', 'challenged', 'manual-allow']),
    decision: z.enum(['allow', 'deny', 'review', 'challenge']).optional(),
    txId: z.string().optional(),
    reason: z.string().optional(),
  }),
);

export const ClaimStatusResponse = registry.register(
  'ClaimStatus',
  z.object({
    id: z.string(),
    status: z.string(),
    address: z.string(),
    amountLuna: z.string(),
    txId: z.string().nullable(),
    createdAt: z.union([z.string(), z.number()]),
    decision: z.string().nullable(),
    rejectionReason: z.string().nullable(),
  }),
);

export const FaucetConfig = registry.register(
  'FaucetConfig',
  z.object({
    network: z.enum(['main', 'test']),
    claimAmountLuna: z.string(),
    abuseLayers: z.object({
      turnstile: z.boolean(),
      hcaptcha: z.boolean(),
      hashcash: z.boolean(),
      geoip: z.boolean(),
      fingerprint: z.boolean(),
      onchain: z.boolean(),
      ai: z.boolean(),
    }),
    captcha: z
      .object({ provider: z.enum(['turnstile', 'hcaptcha']), siteKey: z.string() })
      .nullable(),
    hashcash: z.object({ difficulty: z.number().int(), ttlMs: z.number().int() }).nullable(),
  }),
);

export const HashcashChallenge = registry.register(
  'HashcashChallenge',
  z.object({
    challenge: z.string(),
    difficulty: z.number().int(),
    expiresAt: z.number().int().describe('Unix ms timestamp'),
  }),
);

export const ChallengeRequest = registry.register(
  'ChallengeRequest',
  z.object({ uid: z.string().max(128).optional() }),
);

export const StatsResponse = registry.register(
  'StatsResponse',
  z.object({
    total: z.number().int(),
    byStatus: z.record(z.number().int()),
    byDecision: z.record(z.number().int()),
  }),
);

export const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    error: z.string(),
    code: z.string().optional(),
    message: z.string().optional(),
    issues: z.array(z.unknown()).optional(),
  }),
);

// ---------- Admin ----------

export const LoginRequest = registry.register(
  'LoginRequest',
  z.object({
    password: z.string().min(1).max(512),
    totp: z.string().min(1).max(16).optional(),
  }),
);

export const LoginResponse = registry.register(
  'LoginResponse',
  z.object({
    ok: z.literal(true),
    expiresAt: z.string(),
    totpProvisioningUri: z.string().optional(),
    totpSecret: z.string().optional(),
  }),
);

export const OverviewResponse = registry.register(
  'OverviewResponse',
  z.object({
    balance: z.string(),
    claimsLastHour: z.number().int(),
    claimsLast24h: z.number().int(),
    successRate: z.number().min(0).max(1),
    topRejectionReasons: z.array(z.object({ reason: z.string(), count: z.number().int() })),
  }),
);

export const ClaimListItem = registry.register(
  'ClaimListItem',
  z.object({
    id: z.string(),
    createdAt: z.union([z.string(), z.number()]),
    address: z.string(),
    status: z.string(),
    decision: z.string().nullable(),
    txId: z.string().nullable(),
    ip: z.string().nullable(),
    integratorId: z.string().nullable(),
    abuseScore: z.number().int().nullable(),
    rejectionReason: z.string().nullable(),
  }),
);

export const ClaimListResponse = registry.register(
  'ClaimListResponse',
  z.object({ total: z.number().int(), items: z.array(ClaimListItem) }),
);

export const BlocklistEntry = registry.register(
  'BlocklistEntry',
  z.object({
    id: z.string(),
    kind: z.enum(['ip', 'address', 'uid', 'asn', 'country']),
    value: z.string(),
    reason: z.string().nullable(),
    createdAt: z.union([z.string(), z.number()]),
    expiresAt: z.union([z.string(), z.number()]).nullable(),
  }),
);

export const BlocklistCreateRequest = registry.register(
  'BlocklistCreateRequest',
  z.object({
    kind: z.enum(['ip', 'address', 'uid', 'asn', 'country']),
    value: z.string().min(1).max(128),
    reason: z.string().max(256).optional(),
    expiresAt: z.union([z.string(), z.number()]).optional(),
  }),
);

export const IntegratorRecord = registry.register(
  'IntegratorRecord',
  z.object({
    id: z.string(),
    createdAt: z.union([z.string(), z.number()]),
    lastUsedAt: z.union([z.string(), z.number()]).nullable(),
    revokedAt: z.union([z.string(), z.number()]).nullable(),
  }),
);

export const IntegratorCreateRequest = registry.register(
  'IntegratorCreateRequest',
  z.object({ id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/) }),
);

export const IntegratorCredential = registry.register(
  'IntegratorCredential',
  z.object({ id: z.string(), apiKey: z.string(), hmacSecret: z.string() }),
);

export const AuditEntry = registry.register(
  'AuditEntry',
  z.object({
    id: z.string(),
    ts: z.union([z.string(), z.number()]),
    actor: z.string(),
    action: z.string(),
    target: z.string().nullable(),
    // NOTE: signals shape will be tightened as admin actions stabilise.
    signals: z.record(z.unknown()),
  }),
);

export const AuditListResponse = registry.register(
  'AuditListResponse',
  z.object({ total: z.number().int(), items: z.array(AuditEntry) }),
);

export const AdminConfigPatch = registry.register(
  'AdminConfigPatch',
  z
    .object({
      claimAmountLuna: z.string().regex(/^\d+$/).optional(),
      rateLimitPerIpPerDay: z.number().int().min(1).max(10_000).optional(),
      abuseDenyThreshold: z.number().min(0).max(1).optional(),
      abuseReviewThreshold: z.number().min(0).max(1).optional(),
      layers: z
        .object({
          turnstile: z.boolean().optional(),
          hcaptcha: z.boolean().optional(),
          hashcash: z.boolean().optional(),
          geoip: z.boolean().optional(),
          fingerprint: z.boolean().optional(),
          onchain: z.boolean().optional(),
          ai: z.boolean().optional(),
        })
        .optional(),
    })
    .strict(),
);

export const AdminConfigResponse = registry.register(
  'AdminConfigResponse',
  z.object({
    base: z.object({
      claimAmountLuna: z.string(),
      rateLimitPerIpPerDay: z.number().int(),
      abuseDenyThreshold: z.number(),
      abuseReviewThreshold: z.number(),
      layers: z.record(z.boolean()),
    }),
    overrides: z.record(z.unknown()),
  }),
);

export const AdminAccount = registry.register(
  'AdminAccount',
  z.object({
    address: z.string(),
    balance: z.string(),
    recentPayouts: z.array(
      z.object({
        id: z.string(),
        address: z.string(),
        amountLuna: z.string(),
        txId: z.string().nullable(),
        createdAt: z.union([z.string(), z.number()]),
        status: z.string(),
      }),
    ),
  }),
);

export const AdminSendRequest = registry.register(
  'AdminSendRequest',
  z.object({
    to: z.string().min(1),
    amountLuna: z.union([z.string().regex(/^\d+$/), z.number().int().min(1)]),
    memo: z.string().max(256).optional(),
  }),
);

export const OkResponse = registry.register('OkResponse', z.object({ ok: z.literal(true) }));

export const McpDiscoveryResponse = registry.register(
  'McpDiscovery',
  z.object({
    name: z.string(),
    version: z.string(),
    transport: z.literal('streamable-http'),
    tools: z.array(z.object({ name: z.string(), admin: z.boolean() })),
  }),
);
