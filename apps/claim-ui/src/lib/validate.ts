import {
  isValidNimiqAddress as isValidNimiqAddressCore,
  normalizeNimiqAddress as normalizeNimiqAddressCore,
} from '@faucet/core';

export function isValidNimiqAddress(input: string): boolean {
  return isValidNimiqAddressCore(input);
}

export function normalizeNimiqAddress(input: string): string {
  return normalizeNimiqAddressCore(input);
}
