import { describe, expect, it } from 'vitest';
import { normalizeBlocklistValue } from '../src/index.js';

describe('normalizeBlocklistValue (#94)', () => {
  describe('ip', () => {
    it('strips the IPv6-mapped IPv4 prefix', () => {
      expect(normalizeBlocklistValue('ip', '::ffff:1.2.3.4')).toBe('1.2.3.4');
    });
    it('lower-cases an IPv6 literal', () => {
      expect(normalizeBlocklistValue('ip', '2001:DB8::1')).toBe('2001:db8::1');
    });
    it('strips a zone-id suffix', () => {
      expect(normalizeBlocklistValue('ip', 'fe80::1%eth0')).toBe('fe80::1');
    });
    it('trims surrounding whitespace', () => {
      expect(normalizeBlocklistValue('ip', '  1.2.3.4  ')).toBe('1.2.3.4');
    });
  });

  describe('address', () => {
    it('canonicalises NQ addresses to uppercase + single-spaced groups', () => {
      const lowercase = 'nq07 0000 0000 0000 0000 0000 0000 0000 0000';
      const expected = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';
      expect(normalizeBlocklistValue('address', lowercase)).toBe(expected);
    });
    it('collapses multiple internal spaces to single spaces', () => {
      expect(normalizeBlocklistValue('address', 'NQ07  0000   0000 0000 0000 0000 0000 0000 0000'))
        .toBe('NQ07 0000 0000 0000 0000 0000 0000 0000 0000');
    });
  });

  describe('country', () => {
    it('uppercases', () => {
      expect(normalizeBlocklistValue('country', 'us')).toBe('US');
      expect(normalizeBlocklistValue('country', '  De  ')).toBe('DE');
    });
  });

  describe('asn', () => {
    it('strips leading zeros via integer parsing', () => {
      expect(normalizeBlocklistValue('asn', '0015169')).toBe('15169');
      expect(normalizeBlocklistValue('asn', ' 32934 ')).toBe('32934');
    });
    it('passes through unparseable values unchanged (defensive)', () => {
      expect(normalizeBlocklistValue('asn', 'AS15169')).toBe('AS15169');
    });
  });

  describe('uid', () => {
    it('only trims (uids are opaque hashes — case is meaningful)', () => {
      expect(normalizeBlocklistValue('uid', '  abc123  ')).toBe('abc123');
      expect(normalizeBlocklistValue('uid', 'ABC123')).toBe('ABC123');
    });
  });

  it('returns input unchanged for unknown kinds', () => {
    expect(normalizeBlocklistValue('weird', '  Mixed Case  ')).toBe('  Mixed Case  ');
  });
});
