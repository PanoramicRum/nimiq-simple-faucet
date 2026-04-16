import type { Address, HistorySummary, NetworkId, TxId } from './types.js';

export interface CurrencyDriver {
  readonly id: string;
  readonly networks: readonly NetworkId[];

  init(): Promise<void>;

  parseAddress(input: string): Address;

  getFaucetAddress(): Promise<Address>;
  getBalance(): Promise<bigint>;

  send(to: Address, amount: bigint, memo?: string): Promise<TxId>;
  waitForConfirmation(tx: TxId, timeoutMs?: number): Promise<void>;

  addressHistory?(address: Address): Promise<HistorySummary>;
}

export interface CurrencyDriverFactory<C = unknown> {
  readonly id: string;
  create(config: C): Promise<CurrencyDriver>;
}
