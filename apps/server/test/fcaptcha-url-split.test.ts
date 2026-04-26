import { describe, expect, it } from 'vitest';
import { ServerConfigSchema, resolveFcaptchaUrls } from '../src/config.js';

/**
 * Issue #118: FAUCET_FCAPTCHA_URL split into PUBLIC (browser-facing) and
 * INTERNAL (server-to-server). The legacy single var is kept as a
 * fallback for one minor — these tests pin the fallback matrix so it
 * doesn't drift.
 */

const FAUCET_ADDR = 'NQ58 U4HN TVVA 8UCC X4U6 5KSJ MBQT 9HKX 47YE';

function configWith(overrides: Record<string, unknown>) {
  return ServerConfigSchema.parse({
    geoipBackend: 'none',
    network: 'test',
    dataDir: '/tmp',
    signerDriver: 'wasm',
    walletAddress: FAUCET_ADDR,
    claimAmountLuna: '100000',
    adminPassword: 'test-password-123',
    privateKey: 'a'.repeat(64),
    keyPassphrase: 'test-passphrase-12',
    ...overrides,
  });
}

describe('resolveFcaptchaUrls', () => {
  it('keeps both URLs as-is when both are set explicitly', () => {
    const config = configWith({
      fcaptchaPublicUrl: 'https://captcha.example.com',
      fcaptchaInternalUrl: 'http://fcaptcha:3000',
    });
    const out = resolveFcaptchaUrls(config);
    expect(out.fcaptchaPublicUrl).toBe('https://captcha.example.com');
    expect(out.fcaptchaInternalUrl).toBe('http://fcaptcha:3000');
  });

  it('defaults INTERNAL to PUBLIC when only PUBLIC is set', () => {
    const config = configWith({ fcaptchaPublicUrl: 'https://captcha.example.com' });
    const out = resolveFcaptchaUrls(config);
    expect(out.fcaptchaPublicUrl).toBe('https://captcha.example.com');
    expect(out.fcaptchaInternalUrl).toBe('https://captcha.example.com');
  });

  it('falls back to legacy fcaptchaUrl when neither new var is set', () => {
    const config = configWith({ fcaptchaUrl: 'http://fcaptcha:3000' });
    const out = resolveFcaptchaUrls(config);
    expect(out.fcaptchaPublicUrl).toBe('http://fcaptcha:3000');
    expect(out.fcaptchaInternalUrl).toBe('http://fcaptcha:3000');
  });

  it('legacy fcaptchaUrl is overridden by explicit PUBLIC + INTERNAL', () => {
    const config = configWith({
      fcaptchaUrl: 'http://legacy:3000',
      fcaptchaPublicUrl: 'https://captcha.example.com',
      fcaptchaInternalUrl: 'http://fcaptcha:3000',
    });
    const out = resolveFcaptchaUrls(config);
    expect(out.fcaptchaPublicUrl).toBe('https://captcha.example.com');
    expect(out.fcaptchaInternalUrl).toBe('http://fcaptcha:3000');
  });

  it('leaves both undefined when fcaptcha is not configured at all', () => {
    const config = configWith({});
    const out = resolveFcaptchaUrls(config);
    expect(out.fcaptchaPublicUrl).toBeUndefined();
    expect(out.fcaptchaInternalUrl).toBeUndefined();
  });
});
