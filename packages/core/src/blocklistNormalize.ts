/**
 * Canonicalise blocklist values so the lookup and insert paths agree
 * regardless of how an admin or a request arrived at the same logical
 * entry. Without this, three real-world bypasses are possible:
 *
 *   - IPv6-mapped IPv4: an admin types `1.2.3.4`, the request socket
 *     surfaces `::ffff:1.2.3.4`, the lookup misses.
 *   - NQ address spacing/case: stored as `NQ07 …` with spaces, the
 *     incoming claim sends `nq07…` lowercase no spaces, the lookup misses.
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
      // Reuse the existing canonical form: uppercase, single-spaces.
      return normalizeNimiqAddress(value);
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
