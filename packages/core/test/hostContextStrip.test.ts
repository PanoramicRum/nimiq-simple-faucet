import { describe, expect, it } from 'vitest';
import { stripUnsignedHostContext } from '../src/index.js';

describe('stripUnsignedHostContext (#96)', () => {
  it('drops every trust-claim field', () => {
    const forged = {
      kycLevel: 'id' as const,
      accountAgeDays: 365,
      emailDomainHash: 'abcd',
      verifiedIdentities: ['google', 'apple'],
      tags: ['premium'],
    };
    const stripped = stripUnsignedHostContext(forged);
    expect(stripped).toEqual({});
  });

  it('preserves correlation hashes (uid / cookieHash / sessionHash)', () => {
    const ctx = {
      uid: 'u-1',
      cookieHash: 'c-1',
      sessionHash: 's-1',
      kycLevel: 'id' as const,
      verifiedIdentities: ['google'],
    };
    const stripped = stripUnsignedHostContext(ctx);
    expect(stripped).toEqual({
      uid: 'u-1',
      cookieHash: 'c-1',
      sessionHash: 's-1',
    });
  });

  it('preserves the (already-known-bad) signature for audit logging', () => {
    const stripped = stripUnsignedHostContext({
      signature: 'integrator:not-real-base64',
      kycLevel: 'phone',
    });
    expect(stripped.signature).toBe('integrator:not-real-base64');
    expect(stripped.kycLevel).toBeUndefined();
  });

  it('returns an empty object on an empty input', () => {
    expect(stripUnsignedHostContext({})).toEqual({});
  });

  it('does not mutate the input', () => {
    const original = {
      uid: 'u-1',
      kycLevel: 'id' as const,
      verifiedIdentities: ['google'],
    };
    const snapshot = { ...original, verifiedIdentities: [...original.verifiedIdentities] };
    stripUnsignedHostContext(original);
    expect(original).toEqual(snapshot);
  });
});
