// Mirrors the regex in packages/driver-nimiq-rpc/src/index.ts (parseAddress).
const NIMIQ_ADDRESS_RE = /^NQ[0-9]{2}(?: ?[0-9A-Z]{4}){8}$/;

export function isValidNimiqAddress(input: string): boolean {
  if (!input) return false;
  const normalized = input.trim().toUpperCase().replace(/\s+/g, ' ');
  return NIMIQ_ADDRESS_RE.test(normalized);
}

export function normalizeNimiqAddress(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, ' ');
}
