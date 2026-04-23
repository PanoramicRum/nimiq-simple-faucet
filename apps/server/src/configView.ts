/**
 * Centralized config → API-response derivation.
 *
 * The abuse-layer toggle list, public /v1/config response, and admin
 * /admin/config base object are derived here instead of being
 * hand-mapped in each route handler. Single source of truth for layer
 * names and computed booleans.
 */
import type { ServerConfig } from './config.js';

export function deriveAbuseLayers(config: ServerConfig) {
  return {
    turnstile: !!config.turnstileSiteKey,
    hcaptcha: !!config.hcaptchaSiteKey,
    fcaptcha: !!(config.fcaptchaSiteKey && config.fcaptchaUrl),
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
        : config.fcaptchaSiteKey && config.fcaptchaUrl
          ? {
              provider: 'fcaptcha' as const,
              siteKey: config.fcaptchaSiteKey,
              serverUrl: config.fcaptchaUrl,
            }
          : null,
    hashcash: config.hashcashSecret
      ? { difficulty: config.hashcashDifficulty, ttlMs: config.hashcashTtlMs }
      : null,
    geoipAttribution:
      config.geoipBackend === 'dbip'
        ? 'IP geolocation by DB-IP (https://db-ip.com)'
        : undefined,
  };
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
