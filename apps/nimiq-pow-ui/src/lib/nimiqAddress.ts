/**
 * Local Nimiq address validator. Mirrors `@faucet/core`'s regex shape
 * check, then adds the canonical IBAN mod-97 checksum so the Claim
 * button only enables on addresses that round-trip through Nimiq's
 * standard validation.
 *
 * Format: `NQxx XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX`
 * - 36 chars stripped of spaces
 * - "NQ" prefix + 2 check digits + 32 base32-ish chars (`0-9 A-Z`)
 *
 * Checksum (IBAN-style):
 *   1. Strip spaces, uppercase
 *   2. Move the first 4 chars (country + check digits) to the end
 *   3. Replace each letter with `letter.charCodeAt(0) - 55` (A=10 ... Z=35)
 *   4. The resulting integer mod 97 must equal 1
 */

const SHAPE_RE = /^NQ[0-9]{2}[0-9A-Z]{32}$/;

function strip(addr: string): string {
  return addr.trim().toUpperCase().replace(/\s+/g, '');
}

function ibanMod97(stripped: string): number {
  // Rearrange: rest + first-4
  const rearranged = stripped.slice(4) + stripped.slice(0, 4);
  // Convert letters to two-digit numbers, fold mod 97 incrementally so
  // we never overflow the safe-integer range on long strings.
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const value = code >= 65 ? code - 55 : code - 48; // letter or digit
    // Each letter expands to two digits (10..35), so apply mod twice.
    if (value >= 10) {
      remainder = (remainder * 100 + value) % 97;
    } else {
      remainder = (remainder * 10 + value) % 97;
    }
  }
  return remainder;
}

export function isValidNimiqAddress(input: string): boolean {
  if (!input) return false;
  const stripped = strip(input);
  if (!SHAPE_RE.test(stripped)) return false;
  return ibanMod97(stripped) === 1;
}
