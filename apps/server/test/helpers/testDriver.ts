import {
  isValidNimiqAddress,
  normalizeNimiqAddress,
  type Address,
  type CurrencyDriver,
  type TxId,
} from '@faucet/core';

export const TEST_FAUCET_ADDRESS = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';

export function parseNimiqAddressForTest(input: string, errorPrefix = 'bad address'): Address {
  const normalized = normalizeNimiqAddress(input);
  if (!isValidNimiqAddress(normalized)) {
    throw new Error(`${errorPrefix}: ${input}`);
  }
  return normalized as Address;
}

export class BaseTestDriver implements CurrencyDriver {
  readonly id = 'nimiq';
  readonly networks = ['test'] as const;

  async init(): Promise<void> {}

  parseAddress(input: string): Address {
    return parseNimiqAddressForTest(input);
  }

  async getFaucetAddress(): Promise<Address> {
    return TEST_FAUCET_ADDRESS as Address;
  }

  async getBalance(): Promise<bigint> {
    return 0n;
  }

  async send(_to: Address, _amount: bigint): Promise<TxId> {
    return 'tx_1' as TxId;
  }

  async waitForConfirmation(): Promise<void> {}
}

export function parseCookie(setCookie: string | string[] | undefined, name: string): string | null {
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const line of arr) {
    const m = line.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (m) return decodeURIComponent(m[1]!);
  }
  return null;
}
