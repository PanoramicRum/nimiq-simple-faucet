import { z } from 'zod';

export const ServerConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.coerce.number().int().min(1).max(65_535).default(8080),
  network: z.enum(['main', 'test']).default('test'),
  dev: z.coerce.boolean().default(false),

  dataDir: z.string().default('/data'),
  databaseUrl: z.string().optional(),
  redisUrl: z.string().optional(),

  signerDriver: z.enum(['wasm', 'rpc']).default('rpc'),
  rpcUrl: z.string().optional(),
  rpcUsername: z.string().optional(),
  rpcPassword: z.string().optional(),
  walletAddress: z.string().optional(),
  walletPassphrase: z.string().optional(),
  privateKey: z.string().optional(),
  keyPassphrase: z.string().min(8).optional(),

  claimAmountLuna: z.coerce.bigint().default(100_000n),
  rateLimitPerMinute: z.coerce.number().int().min(1).default(30),
  rateLimitPerIpPerDay: z.coerce.number().int().min(1).default(5),

  turnstileSiteKey: z.string().optional(),
  turnstileSecret: z.string().optional(),
  hcaptchaSiteKey: z.string().optional(),
  hcaptchaSecret: z.string().optional(),
  fcaptchaUrl: z.string().url().optional(),
  fcaptchaSiteKey: z.string().optional(),
  fcaptchaSecret: z.string().optional(),

  hashcashSecret: z.string().min(16).optional(),
  hashcashDifficulty: z.coerce.number().int().min(8).max(30).default(20),
  hashcashTtlMs: z.coerce.number().int().min(10_000).default(5 * 60_000),

  geoipBackend: z.enum(['none', 'dbip', 'maxmind', 'ipinfo']).default('dbip'),
  geoipMaxmindCountryDb: z.string().optional(),
  geoipMaxmindAsnDb: z.string().optional(),
  geoipIpinfoToken: z.string().optional(),
  geoipDenyCountries: z
    .string()
    .optional()
    .transform((v) =>
      v ? v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : [],
    ),
  geoipAllowCountries: z
    .string()
    .optional()
    .transform((v) =>
      v ? v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : [],
    ),
  geoipDenyAsns: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return [] as number[];
      return v
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    }),
  geoipDenyVpn: z.coerce.boolean().default(false),
  geoipDenyTor: z.coerce.boolean().default(false),
  geoipDenyHosting: z.coerce.boolean().default(false),

  fingerprintEnabled: z.coerce.boolean().default(false),
  fingerprintWindowMs: z.coerce.number().int().min(60_000).default(24 * 60 * 60_000),
  fingerprintMaxVisitorsPerUid: z.coerce.number().int().min(1).default(3),
  fingerprintMaxUidsPerVisitor: z.coerce.number().int().min(1).default(3),

  onchainEnabled: z.coerce.boolean().default(false),
  onchainDenyIfSweeper: z.coerce.boolean().default(true),
  onchainSoftScoreFreshAddress: z.coerce.boolean().default(true),

  aiEnabled: z.coerce.boolean().default(false),
  aiDenyThreshold: z.coerce.number().min(0).max(1).default(0.85),
  aiReviewThreshold: z.coerce.number().min(0).max(1).default(0.65),

  adminPassword: z.string().min(8).optional(),
  adminTotpSecret: z.string().optional(),
  adminSessionTtlMs: z.coerce.number().int().min(60_000).default(8 * 60 * 60_000),
  adminTotpStepUpTtlMs: z.coerce.number().int().min(30_000).default(2 * 60_000),
  adminLoginRatePerMinute: z.coerce.number().int().min(1).default(5),
  challengeRatePerMinute: z.coerce.number().int().min(1).default(10),
  keyringPath: z.string().optional(),

  requireBrowser: z.coerce.boolean().default(false),
  uiEnabled: z.coerce.boolean().default(true),
  claimUiDir: z.string().optional(),
  dashboardDir: z.string().optional(),

  // When true, `/docs/api` is served outside dev mode too. `/openapi.json`
  // is always public regardless of this flag.
  openapiPublic: z.coerce.boolean().default(false),

  integratorKeys: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => {
              const [id, key, secret] = entry.split(':');
              if (!id || !key || !secret) {
                throw new Error(`Invalid FAUCET_INTEGRATOR_KEYS entry: ${entry}`);
              }
              return { id, key, secret };
            })
        : [],
    ),

  corsOrigins: z
    .string()
    .default('*')
    .transform((v) =>
      v === '*' ? true : v.split(',').map((s) => s.trim()).filter(Boolean),
    ),

  tlsRequired: z.coerce.boolean().default(true),
  helmetCsp: z.enum(['strict', 'relaxed-for-ui', 'off']).default('relaxed-for-ui'),

  metricsEnabled: z.coerce.boolean().default(true),
  reconcileEnabled: z.coerce.boolean().default(true),
  reconcileIntervalMs: z.coerce.number().int().min(10_000).default(5 * 60_000),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

const ENV_KEYS: Record<string, string> = {
  host: 'FAUCET_HOST',
  port: 'FAUCET_PORT',
  network: 'FAUCET_NETWORK',
  dev: 'FAUCET_DEV',
  dataDir: 'FAUCET_DATA_DIR',
  databaseUrl: 'DATABASE_URL',
  redisUrl: 'REDIS_URL',
  signerDriver: 'FAUCET_SIGNER_DRIVER',
  rpcUrl: 'FAUCET_RPC_URL',
  rpcUsername: 'FAUCET_RPC_USERNAME',
  rpcPassword: 'FAUCET_RPC_PASSWORD',
  walletAddress: 'FAUCET_WALLET_ADDRESS',
  walletPassphrase: 'FAUCET_WALLET_PASSPHRASE',
  privateKey: 'FAUCET_PRIVATE_KEY',
  keyPassphrase: 'FAUCET_KEY_PASSPHRASE',
  claimAmountLuna: 'FAUCET_CLAIM_AMOUNT_LUNA',
  rateLimitPerMinute: 'FAUCET_RATE_LIMIT_PER_MINUTE',
  rateLimitPerIpPerDay: 'FAUCET_RATE_LIMIT_PER_IP_PER_DAY',
  turnstileSiteKey: 'FAUCET_TURNSTILE_SITE_KEY',
  turnstileSecret: 'FAUCET_TURNSTILE_SECRET',
  hcaptchaSiteKey: 'FAUCET_HCAPTCHA_SITE_KEY',
  hcaptchaSecret: 'FAUCET_HCAPTCHA_SECRET',
  fcaptchaUrl: 'FAUCET_FCAPTCHA_URL',
  fcaptchaSiteKey: 'FAUCET_FCAPTCHA_SITE_KEY',
  fcaptchaSecret: 'FAUCET_FCAPTCHA_SECRET',
  hashcashSecret: 'FAUCET_HASHCASH_SECRET',
  hashcashDifficulty: 'FAUCET_HASHCASH_DIFFICULTY',
  hashcashTtlMs: 'FAUCET_HASHCASH_TTL_MS',
  geoipBackend: 'FAUCET_GEOIP_BACKEND',
  geoipMaxmindCountryDb: 'FAUCET_GEOIP_MAXMIND_COUNTRY_DB',
  geoipMaxmindAsnDb: 'FAUCET_GEOIP_MAXMIND_ASN_DB',
  geoipIpinfoToken: 'FAUCET_GEOIP_IPINFO_TOKEN',
  geoipDenyCountries: 'FAUCET_GEOIP_DENY_COUNTRIES',
  geoipAllowCountries: 'FAUCET_GEOIP_ALLOW_COUNTRIES',
  geoipDenyAsns: 'FAUCET_GEOIP_DENY_ASNS',
  geoipDenyVpn: 'FAUCET_GEOIP_DENY_VPN',
  geoipDenyTor: 'FAUCET_GEOIP_DENY_TOR',
  geoipDenyHosting: 'FAUCET_GEOIP_DENY_HOSTING',
  fingerprintEnabled: 'FAUCET_FINGERPRINT_ENABLED',
  fingerprintWindowMs: 'FAUCET_FINGERPRINT_WINDOW_MS',
  fingerprintMaxVisitorsPerUid: 'FAUCET_FINGERPRINT_MAX_VISITORS_PER_UID',
  fingerprintMaxUidsPerVisitor: 'FAUCET_FINGERPRINT_MAX_UIDS_PER_VISITOR',
  onchainEnabled: 'FAUCET_ONCHAIN_ENABLED',
  onchainDenyIfSweeper: 'FAUCET_ONCHAIN_DENY_IF_SWEEPER',
  onchainSoftScoreFreshAddress: 'FAUCET_ONCHAIN_SOFT_FRESH_ADDRESS',
  aiEnabled: 'FAUCET_AI_ENABLED',
  aiDenyThreshold: 'FAUCET_AI_DENY_THRESHOLD',
  aiReviewThreshold: 'FAUCET_AI_REVIEW_THRESHOLD',
  adminPassword: 'FAUCET_ADMIN_PASSWORD',
  adminTotpSecret: 'FAUCET_ADMIN_TOTP_SECRET',
  adminSessionTtlMs: 'FAUCET_ADMIN_SESSION_TTL_MS',
  adminTotpStepUpTtlMs: 'FAUCET_ADMIN_TOTP_STEP_UP_TTL_MS',
  adminLoginRatePerMinute: 'FAUCET_ADMIN_LOGIN_RATE_PER_MINUTE',
  challengeRatePerMinute: 'FAUCET_CHALLENGE_RATE_PER_MINUTE',
  keyringPath: 'FAUCET_KEYRING_PATH',
  requireBrowser: 'FAUCET_REQUIRE_BROWSER',
  uiEnabled: 'FAUCET_UI_ENABLED',
  claimUiDir: 'FAUCET_CLAIM_UI_DIR',
  dashboardDir: 'FAUCET_DASHBOARD_DIR',
  openapiPublic: 'FAUCET_OPENAPI_PUBLIC',
  integratorKeys: 'FAUCET_INTEGRATOR_KEYS',
  corsOrigins: 'FAUCET_CORS_ORIGINS',
  tlsRequired: 'FAUCET_TLS_REQUIRED',
  helmetCsp: 'FAUCET_HELMET_CSP',
  metricsEnabled: 'FAUCET_METRICS_ENABLED',
  reconcileEnabled: 'FAUCET_RECONCILE_ENABLED',
  reconcileIntervalMs: 'FAUCET_RECONCILE_INTERVAL_MS',
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const raw: Record<string, unknown> = {};
  for (const [field, envName] of Object.entries(ENV_KEYS)) {
    const v = env[envName];
    if (v !== undefined && v !== '') raw[field] = v;
  }
  return ServerConfigSchema.parse(raw);
}
