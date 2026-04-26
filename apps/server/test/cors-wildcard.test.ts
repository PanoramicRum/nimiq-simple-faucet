import { describe, expect, it } from 'vitest';
import { ServerConfigSchema } from '../src/config.js';

/**
 * Issue #122: `FAUCET_CORS_ORIGINS` accepts `*.example.com` as a
 * wildcard subdomain entry. Each entry becomes either a literal string
 * (exact match) or a RegExp (wildcard match). Fastify CORS accepts
 * `(string | RegExp)[]`, so the parser change is contained — but the
 * shape contract matters, so pin it.
 */

const FAUCET_ADDR = 'NQ58 U4HN TVVA 8UCC X4U6 5KSJ MBQT 9HKX 47YE';

function parse(corsOrigins: string) {
  const config = ServerConfigSchema.parse({
    geoipBackend: 'none',
    network: 'test',
    dataDir: '/tmp',
    signerDriver: 'wasm',
    walletAddress: FAUCET_ADDR,
    privateKey: 'a'.repeat(64),
    keyPassphrase: 'test-passphrase-12',
    adminPassword: 'test-password-123',
    corsOrigins,
  });
  return config.corsOrigins;
}

function matchesAny(entries: ReadonlyArray<string | RegExp>, origin: string): boolean {
  return entries.some((e) => (typeof e === 'string' ? e === origin : e.test(origin)));
}

describe('FAUCET_CORS_ORIGINS parser (#122)', () => {
  it('returns true for wildcard `*`', () => {
    expect(parse('*')).toBe(true);
  });

  it('returns a list of literal strings for plain origins', () => {
    const out = parse('https://app.example.com,https://admin.example.com');
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  it('converts `*.example.com` to a RegExp matching subdomains', () => {
    const out = parse('*.example.com') as ReadonlyArray<string | RegExp>;
    expect(out).toHaveLength(1);
    expect(out[0]).toBeInstanceOf(RegExp);
    expect(matchesAny(out, 'https://staging-1.example.com')).toBe(true);
    expect(matchesAny(out, 'http://staging.example.com')).toBe(true);
    expect(matchesAny(out, 'https://staging.example.com:8080')).toBe(true);
  });

  it('subdomain wildcard does NOT match the apex', () => {
    const out = parse('*.example.com');
    expect(matchesAny(out as ReadonlyArray<string | RegExp>, 'https://example.com')).toBe(false);
  });

  it('subdomain wildcard does NOT match deeper labels (only one label)', () => {
    const out = parse('*.example.com');
    expect(matchesAny(out as ReadonlyArray<string | RegExp>, 'https://a.b.example.com')).toBe(false);
  });

  it('subdomain wildcard does NOT match unrelated hosts', () => {
    const out = parse('*.example.com');
    expect(matchesAny(out as ReadonlyArray<string | RegExp>, 'https://evil.com')).toBe(false);
    expect(matchesAny(out as ReadonlyArray<string | RegExp>, 'https://example.com.evil.com')).toBe(false);
    expect(matchesAny(out as ReadonlyArray<string | RegExp>, 'https://staging.example.com.evil.com')).toBe(false);
  });

  it('mixed literal + wildcard entries each match their own form', () => {
    const out = parse('https://app.example.com, *.staging.example.com') as ReadonlyArray<string | RegExp>;
    expect(out).toHaveLength(2);
    expect(matchesAny(out, 'https://app.example.com')).toBe(true);
    expect(matchesAny(out, 'https://x.staging.example.com')).toBe(true);
    expect(matchesAny(out, 'https://staging.example.com')).toBe(false);
    expect(matchesAny(out, 'https://app.staging.example.com')).toBe(true);
  });

  it('escapes regex metacharacters inside the host', () => {
    // Hypothetical; a real domain wouldn't have a dot here, but the
    // parser must not let `*.exa.mple` get turned into a regex where
    // `.` matches any character.
    const out = parse('*.exa.mple') as ReadonlyArray<string | RegExp>;
    expect(matchesAny(out, 'https://x.exa.mple')).toBe(true);
    // The escaped dot must not match a non-dot.
    expect(matchesAny(out, 'https://x.exaXmple')).toBe(false);
  });
});
