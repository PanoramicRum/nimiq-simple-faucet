/**
 * Canonical Nimiq address format:
 * `NQxx XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX`
 *
 * We accept optional spaces between 4-char groups, but always normalize
 * to uppercase and single spaces before validation.
 */
export const NIMIQ_ADDRESS_RE = /^NQ[0-9]{2}(?: ?[0-9A-Z]{4}){8}$/;

export function normalizeNimiqAddress(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function isValidNimiqAddress(input: string): boolean {
  if (!input) return false;
  return NIMIQ_ADDRESS_RE.test(normalizeNimiqAddress(input));
}
