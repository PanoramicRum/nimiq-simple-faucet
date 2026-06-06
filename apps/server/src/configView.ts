/**
 * Centralized config → API-response derivation.
 *
 * The abuse-layer toggle list, public /v1/config response, and admin
 * /admin/config base object are derived here instead of being
 * hand-mapped in each route handler. Single source of truth for layer
 * names and computed booleans.
 */
import type { ServerConfig } from './config.js';
import { THEMES, isKnownTheme, DEFAULT_THEME } from './themes.js';
import { resolvePayout, resolveRewardSettings } from './rewards/automatic.js';

/**
 * The amount (Luna) a successful claim actually pays right now, for display in
 * the public/admin config. In automatic mode with a valid baseline this is the
 * baseline; otherwise the fixed `claimAmountLuna`. A misconfigured automatic
 * baseline (resolves to 0n) falls back to `claimAmountLuna` so the public hint
 * stays sensible — the misconfig is surfaced via a boot warning + server logs,
 * not here.
 */
export function effectivePayoutLuna(config: ServerConfig): bigint {
  const { amountLuna } = resolvePayout(config);
  return amountLuna > 0n ? amountLuna : config.claimAmountLuna;
}

export function deriveAbuseLayers(config: ServerConfig) {
  return {
    turnstile: !!config.turnstileSiteKey,
    hcaptcha: !!config.hcaptchaSiteKey,
    fcaptcha: !!(config.fcaptchaSiteKey && config.fcaptchaPublicUrl),
    hashcash: !!config.hashcashSecret,
    geoip: config.geoipBackend !== 'none',
    fingerprint: config.fingerprintEnabled,
    onchain: config.onchainEnabled,
    ai: config.aiEnabled,
  };
}

export function derivePublicConfig(config: ServerConfig) {
  const payoutLuna = effectivePayoutLuna(config);
  return {
    network: config.network,
    claimAmountLuna: payoutLuna.toString(),
    claimAmountNim: (Number(payoutLuna) / 100_000).toString(),
    abuseLayers: deriveAbuseLayers(config),
    captcha: config.turnstileSiteKey
      ? { provider: 'turnstile' as const, siteKey: config.turnstileSiteKey }
      : config.hcaptchaSiteKey
        ? { provider: 'hcaptcha' as const, siteKey: config.hcaptchaSiteKey }
        : config.fcaptchaSiteKey && config.fcaptchaPublicUrl
          ? {
              provider: 'fcaptcha' as const,
              siteKey: config.fcaptchaSiteKey,
              // Issue #118: this is the URL the browser hits — must be
              // browser-reachable, distinct from the internal verify
              // endpoint the server uses.
              serverUrl: config.fcaptchaPublicUrl,
            }
          : null,
    hashcash: config.hashcashSecret
      ? { difficulty: config.hashcashDifficulty, ttlMs: config.hashcashTtlMs }
      : null,
    geoipAttribution:
      config.geoipBackend === 'dbip'
        ? 'IP geolocation by DB-IP (https://db-ip.com)'
        : undefined,
    /**
     * §3.0.16 — UI metadata. The `theme` field always reflects the
     * server's currently-mounted theme. The `themePicker` block is
     * present only when the operator opted into a user-facing theme
     * picker (`FAUCET_THEME_PICKER_ENABLED=true`). When present, it
     * lists every bundled theme's slug + display name so the picker
     * can render the dropdown without hardcoding a theme list.
     */
    ui: deriveUi(config),
  };
}

export function deriveUi(config: ServerConfig) {
  const activeSlug = isKnownTheme(config.claimUiTheme) ? config.claimUiTheme : DEFAULT_THEME;
  const active = THEMES[activeSlug];
  const ui: {
    theme: string;
    displayName: string;
    themePicker?: {
      enabled: boolean;
      themes: Array<{ slug: string; displayName: string; description: string }>;
    };
  } = {
    theme: activeSlug,
    displayName: active.displayName,
  };
  if (config.themePickerEnabled) {
    ui.themePicker = {
      enabled: true,
      themes: (Object.keys(THEMES) as Array<keyof typeof THEMES>).map((slug) => ({
        slug,
        displayName: THEMES[slug].displayName,
        description: THEMES[slug].description,
      })),
    };
  }
  return ui;
}

export function deriveAdminConfigBase(
  config: ServerConfig,
  overrides: Record<string, unknown> = {},
) {
  // Effective low-balance settings = persisted admin override merged over the
  // env default (override wins). Surfaced so the dashboard shows what's actually
  // in force, not just the boot-time env value.
  const reward = resolveRewardSettings(config, overrides);
  return {
    claimAmountLuna: effectivePayoutLuna(config).toString(),
    rateLimitPerIpPerDay: config.rateLimitPerIpPerDay,
    abuseDenyThreshold: config.aiDenyThreshold,
    abuseReviewThreshold: config.aiReviewThreshold,
    lowBalanceThresholdNim: reward.lowBalanceThresholdNim ?? null,
    lowBalanceReductionPercent: reward.lowBalanceReductionPercent ?? null,
    firstTimeBoostPercent: reward.firstTimeBoostPercent ?? null,
    firstTimeBoostUseFingerprint: reward.firstTimeBoostUseFingerprint,
    firstTimeBoostUseUid: reward.firstTimeBoostUseUid,
    layers: deriveAbuseLayers(config),
  };
}
