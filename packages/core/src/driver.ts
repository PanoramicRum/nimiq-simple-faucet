import type { Address, HistorySummary, NetworkId, TxId } from './types.js';

export interface CurrencyDriver {
  readonly id: string;
  readonly networks: readonly NetworkId[];

  /**
   * Lightweight setup. MUST return quickly — long-running work (P2P
   * consensus, initial sync) belongs behind `readyPromise` so the HTTP
   * listener can bind immediately. Throw here only for hard errors
   * (misconfiguration, bad key material).
   */
  init(): Promise<void>;

  /**
   * Resolves when the driver is ready to serve reads/writes. Drivers that
   * are synchronously ready after `init()` may omit this (the server
   * treats a missing `readyPromise` as "ready from t=0").
   */
  readonly readyPromise?: Promise<void> | undefined;

  /**
   * Synchronous readiness check. `true` once `readyPromise` resolves. A
   * driver without `readyPromise` is always ready. The server uses this
   * to 503-gate driver-dependent routes without awaiting.
   */
  isReady?(): boolean;

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
