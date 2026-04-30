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
  /**
   * Minimum wallet balance (in luna) the faucet must hold for `/readyz`
   * to report healthy. Below this, `/readyz` returns 503 so Kubernetes
   * stops routing traffic to a faucet that's about to run dry. Optional
   * — when unset, balance is reported informationally and never fails
   * the probe (preserves the original §1.0 behaviour).
   *
   * Recommended floor: ~10 × `claimAmountLuna` so the probe trips
   * before the wallet actually empties.
   */
  minBalanceLuna: z.coerce.bigint().optional(),
  rateLimitPerMinute: z.coerce.number().int().min(1).default(30),
  rateLimitPerIpPerDay: z.coerce.number().int().min(1).default(5),

  turnstileSiteKey: z.string().optional(),
  turnstileSecret: z.string().optional(),
  hcaptchaSiteKey: z.string().optional(),
  hcaptchaSecret: z.string().optional(),
  // Issue #118: FCaptcha URL split into a server-side internal URL and
  // a browser-side public URL. The single `fcaptchaUrl` (env
  // FAUCET_FCAPTCHA_URL) is kept as a deprecated fallback — when set,
  // both `fcaptchaInternalUrl` and `fcaptchaPublicUrl` default to it,
  // and `loadConfig` logs a deprecation warning. Drop the alias in
  // v1.next.
  fcaptchaUrl: z.string().url().optional(),
  fcaptchaInternalUrl: z.string().url().optional(),
  fcaptchaPublicUrl: z.string().url().optional(),
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
  /** Static bearer-token fallback for admin MCP tools. DEPRECATED in favour
   *  of the admin-session path (#88). Kept so existing operator deployments
   *  don't break when they bump through this version. */
  adminMcpToken: z.string().optional(),
  /** When false, the static `adminMcpToken` is ignored and the only way to
   *  invoke admin MCP tools is a valid admin session cookie + TOTP step-up.
   *  Default `true` for one minor so current deployments keep working; flip
   *  to `false` once you've migrated to the session path. */
  adminMcpAllowStaticToken: z.coerce.boolean().default(true),
  adminSessionTtlMs: z.coerce.number().int().min(60_000).default(8 * 60 * 60_000),
  adminTotpStepUpTtlMs: z.coerce.number().int().min(30_000).default(2 * 60_000),
  adminLoginRatePerMinute: z.coerce.number().int().min(1).default(5),
  challengeRatePerMinute: z.coerce.number().int().min(1).default(10),
  keyringPath: z.string().optional(),

  requireBrowser: z.coerce.boolean().default(false),
  uiEnabled: z.coerce.boolean().default(true),
  claimUiDir: z.string().optional(),
  /**
   * Slug of a bundled Claim UI theme to serve when `claimUiDir` is unset.
   * Default: `porcelain-vault`. Unknown values fall back to the default
   * with a warning log so a typo in deployment env doesn't break the UI.
   * See `apps/server/src/themes.ts` for the registry. Adding a new theme
   * is documented in `docs/contributing-a-frontend.md`.
   */
  claimUiTheme: z.string().default('porcelain-vault'),
  /**
   * §3.0.16: when true, /v1/config exposes the bundled-theme list and
   * the server honours `?theme=<slug>` in the URL (in addition to the
   * env default), so a user-facing theme picker can switch themes on
   * the fly. Default off — operators in production usually want brand
   * consistency, not user-driven theme switching.
   */
  themePickerEnabled: z.coerce.boolean().default(false),
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

  // Issue #122: support `*.example.com` in the comma-separated list.
  // Each entry becomes either a literal string (exact match) or a
  // RegExp (wildcard subdomain match). Fastify CORS accepts a
  // (string | RegExp)[]. The wildcard matches one or more
  // non-dot subdomain labels — `https://staging-1.example.com` ✓,
  // `https://example.com` ✗ (use a separate explicit entry for the
  // apex), `https://evil.com` ✗.
  corsOrigins: z
    .string()
    .default('*')
    .transform((v) => {
      if (v === '*') return true;
      return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((entry) => {
          if (entry.startsWith('*.')) {
            const escaped = entry.slice(2).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`^https?://[^./]+\\.${escaped}(?::\\d+)?$`);
          }
          return entry;
        });
    }),

  tlsRequired: z.coerce.boolean().default(true),
  helmetCsp: z.enum(['strict', 'relaxed-for-ui', 'off']).default('relaxed-for-ui'),

  /**
   * CIDR allow-list of upstream proxies whose `X-Forwarded-For` / `X-Real-IP`
   * the server will honour. Empty (default) means **do not trust any proxy**:
   * `req.ip` becomes the raw socket address, closing IP-spoofing bypasses of
   * the per-IP rate-limit, blocklist, and hashcash IP binding (issue #87).
   *
   * Set via `FAUCET_TRUSTED_PROXY_CIDRS` as a comma-separated list, e.g.
   * `10.0.0.0/8,172.16.0.0/12` for an internal LB. Loopback is included
   * automatically in dev mode for local tests that inject XFF.
   */
  trustedProxyCidrs: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    ),

  metricsEnabled: z.coerce.boolean().default(true),
  reconcileEnabled: z.coerce.boolean().default(true),
  reconcileIntervalMs: z.coerce.number().int().min(10_000).default(5 * 60_000),

  /**
   * How long the driver waits for a broadcast tx to confirm before
   * marking the claim `timeout`. Issue #84: the previous default of
   * 60 s was shorter than Albatross's 120-block validity window
   * (~120 s at 1-second block time), so under network slowdowns the
   * faucet would prematurely flip a still-valid in-flight tx to
   * `timeout` even though it eventually got included.
   *
   * 180 s gives a full validity window plus a small finality buffer;
   * operators on a faster/slower network bake their own value via
   * `FAUCET_CONFIRMATION_TIMEOUT_MS`. Lower bound 30 s for tests.
   */
  confirmationTimeoutMs: z.coerce.number().int().min(30_000).default(180_000),
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
  minBalanceLuna: 'FAUCET_MIN_BALANCE_LUNA',
  rateLimitPerMinute: 'FAUCET_RATE_LIMIT_PER_MINUTE',
  rateLimitPerIpPerDay: 'FAUCET_RATE_LIMIT_PER_IP_PER_DAY',
  turnstileSiteKey: 'FAUCET_TURNSTILE_SITE_KEY',
  turnstileSecret: 'FAUCET_TURNSTILE_SECRET',
  hcaptchaSiteKey: 'FAUCET_HCAPTCHA_SITE_KEY',
  hcaptchaSecret: 'FAUCET_HCAPTCHA_SECRET',
  fcaptchaUrl: 'FAUCET_FCAPTCHA_URL',
  fcaptchaInternalUrl: 'FAUCET_FCAPTCHA_INTERNAL_URL',
  fcaptchaPublicUrl: 'FAUCET_FCAPTCHA_PUBLIC_URL',
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
  adminMcpToken: 'FAUCET_ADMIN_MCP_TOKEN',
  adminMcpAllowStaticToken: 'FAUCET_ADMIN_MCP_ALLOW_STATIC_TOKEN',
  adminSessionTtlMs: 'FAUCET_ADMIN_SESSION_TTL_MS',
  adminTotpStepUpTtlMs: 'FAUCET_ADMIN_TOTP_STEP_UP_TTL_MS',
  adminLoginRatePerMinute: 'FAUCET_ADMIN_LOGIN_RATE_PER_MINUTE',
  challengeRatePerMinute: 'FAUCET_CHALLENGE_RATE_PER_MINUTE',
  keyringPath: 'FAUCET_KEYRING_PATH',
  requireBrowser: 'FAUCET_REQUIRE_BROWSER',
  uiEnabled: 'FAUCET_UI_ENABLED',
  claimUiDir: 'FAUCET_CLAIM_UI_DIR',
  claimUiTheme: 'FAUCET_CLAIM_UI_THEME',
  themePickerEnabled: 'FAUCET_THEME_PICKER_ENABLED',
  dashboardDir: 'FAUCET_DASHBOARD_DIR',
  openapiPublic: 'FAUCET_OPENAPI_PUBLIC',
  integratorKeys: 'FAUCET_INTEGRATOR_KEYS',
  corsOrigins: 'FAUCET_CORS_ORIGINS',
  tlsRequired: 'FAUCET_TLS_REQUIRED',
  helmetCsp: 'FAUCET_HELMET_CSP',
  trustedProxyCidrs: 'FAUCET_TRUSTED_PROXY_CIDRS',
  metricsEnabled: 'FAUCET_METRICS_ENABLED',
  reconcileEnabled: 'FAUCET_RECONCILE_ENABLED',
  reconcileIntervalMs: 'FAUCET_RECONCILE_INTERVAL_MS',
  confirmationTimeoutMs: 'FAUCET_CONFIRMATION_TIMEOUT_MS',
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const raw: Record<string, unknown> = {};
  for (const [field, envName] of Object.entries(ENV_KEYS)) {
    const v = env[envName];
    if (v !== undefined && v !== '') raw[field] = v;
  }
  const config = ServerConfigSchema.parse(raw);
  return resolveFcaptchaUrls(config);
}

/**
 * Issue #118: split FAUCET_FCAPTCHA_URL into INTERNAL/PUBLIC. Server-to-
 * server verification uses INTERNAL (e.g. http://fcaptcha:3000); the
 * URL returned to the browser via /v1/config uses PUBLIC.
 *
 * Backwards-compat fallbacks (in priority order):
 *   1. If INTERNAL is unset, default to PUBLIC.
 *   2. If both are unset, fall back to the deprecated single `fcaptchaUrl`
 *      and log a warning. Operators get one minor to migrate.
 *
 * Exported so tests can exercise the fallback matrix without booting
 * the full app.
 */
export function resolveFcaptchaUrls(config: ServerConfig): ServerConfig {
  const legacy = config.fcaptchaUrl;
  let publicUrl = config.fcaptchaPublicUrl;
  let internalUrl = config.fcaptchaInternalUrl;
  if (!publicUrl && legacy) publicUrl = legacy;
  if (!internalUrl && publicUrl) internalUrl = publicUrl;
  if (legacy && !config.fcaptchaPublicUrl && !config.fcaptchaInternalUrl) {
    // Loud one-shot warning at boot. Don't repeat per-request.
    // eslint-disable-next-line no-console
    console.warn(
      '[deprecation] FAUCET_FCAPTCHA_URL is deprecated (issue #118). ' +
        'Set FAUCET_FCAPTCHA_PUBLIC_URL (browser-reachable) and optionally ' +
        'FAUCET_FCAPTCHA_INTERNAL_URL (server-to-server). The single var ' +
        'will be removed in the next minor release.',
    );
  }
  return { ...config, fcaptchaPublicUrl: publicUrl, fcaptchaInternalUrl: internalUrl };
}
