/**
 * Canonicalise blocklist values so the lookup and insert paths agree
 * regardless of how an admin or a request arrived at the same logical
 * entry. Without this, three real-world bypasses are possible:
 *
 *   - IPv6-mapped IPv4: an admin types `1.2.3.4`, the request socket
 *     surfaces `::ffff:1.2.3.4`, the lookup misses.
 *   - NQ address spacing/case: an admin stores `NQ07 …` with spaces while
 *     the incoming claim sends `nq07…` lowercase no spaces (or vice versa).
 *     `normalizeNimiqAddress` only uppercases + collapses whitespace runs; it
 *     never re-chunks, so the two forms stay distinct and the lookup misses.
 *     For matching we therefore strip ALL spaces — a space-insensitive
 *     canonical form. (Without this the blocklist is fail-open: removing the
 *     group spaces bypasses an address block; and a reward-whitelist entry
 *     silently fails to fire.)
 *   - Country / ASN: case + leading-zero variation.
 *
 * Apply on both sides of the boundary (insert + query). See finding #008
 * in audits/AUDIT-REPORT.md.
 */
import { normalizeNimiqAddress } from './nimiqAddress.js';

export type BlocklistKind = 'ip' | 'address' | 'uid' | 'asn' | 'country';

export function normalizeBlocklistValue(kind: string, value: string): string {
  switch (kind) {
    case 'ip': {
      // Strip the IPv6-mapped IPv4 prefix and the optional zone-id, lower-case
      // the rest. Both `::ffff:1.2.3.4` and `1.2.3.4` collapse to `1.2.3.4`;
      // `fe80::1%eth0` becomes `fe80::1`.
      const v = value.trim().toLowerCase();
      const noZone = v.includes('%') ? (v.split('%')[0] ?? v) : v;
      return noZone.startsWith('::ffff:') ? noZone.slice('::ffff:'.length) : noZone;
    }
    case 'address':
      // Space-insensitive canonical form: uppercase, then strip every space
      // so `NQ07 ABCD …` and `nq07abcd…` collapse to the same key on both the
      // write and the lookup side. Re-chunking into groups would work too but
      // touches display expectations elsewhere; stripping is the minimal
      // matching-only canonicalization.
      return normalizeNimiqAddress(value).replace(/ /g, '');
    case 'country':
      return value.trim().toUpperCase();
    case 'asn': {
      const n = parseInt(value.trim(), 10);
      return Number.isFinite(n) ? String(n) : value.trim();
    }
    case 'uid':
      return value.trim();
    default:
      return value;
  }
}
