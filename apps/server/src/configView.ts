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
  return {
    network: config.network,
    claimAmountLuna: config.claimAmountLuna.toString(),
    claimAmountNim: (Number(config.claimAmountLuna) / 100_000).toString(),
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

export function deriveAdminConfigBase(config: ServerConfig) {
  return {
    claimAmountLuna: config.claimAmountLuna.toString(),
    rateLimitPerIpPerDay: config.rateLimitPerIpPerDay,
    abuseDenyThreshold: config.aiDenyThreshold,
    abuseReviewThreshold: config.aiReviewThreshold,
    layers: deriveAbuseLayers(config),
  };
}
