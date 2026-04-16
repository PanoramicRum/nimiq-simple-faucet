import { request } from 'undici';
import {
  DriverError,
  type Address,
  type CurrencyDriver,
  type CurrencyDriverFactory,
  type HistorySummary,
  type NetworkId,
  type TxId,
} from '@faucet/core';

export interface NimiqRpcDriverConfig {
  network: NetworkId;
  rpcUrl: string;
  /** Optional basic-auth credentials if the RPC node requires them. */
  auth?: { username: string; password: string } | undefined;
  /** Faucet wallet address as already unlocked on the RPC node. */
  walletAddress: string;
  /** Passphrase the node will use to unlock the wallet for sending. */
  walletPassphrase?: string | undefined;
}

interface RpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string;
  /**
   * Albatross wraps every result as `{ data, metadata }` where `data` is the
   * actual payload. We unwrap this inside `#rpc`, so the generic `T` represents
   * the unwrapped shape callers care about.
   */
  result?: { data: T; metadata: unknown } | T;
  error?: { code: number; message: string };
}

// Verified against core-rs-albatross 1.4.0-pre1 on 2026-04-15.
export class NimiqRpcDriver implements CurrencyDriver {
  readonly id = 'nimiq';
  readonly networks: readonly NetworkId[] = ['main', 'test'];

  #config: NimiqRpcDriverConfig;
  #nextId = 1;

  constructor(config: NimiqRpcDriverConfig) {
    this.#config = config;
  }

  async init(): Promise<void> {
    // `getNetworkId` is cheap and exposes the network string directly
    // (`"TestAlbatross"` / `"MainAlbatross"`). `getConsensusState` does not
    // exist on Albatross RPC; use `isConsensusEstablished` if you want the
    // sync status — we don't gate init on it because it's false during the
    // initial sync window.
    const reported = String(await this.#rpc<string>('getNetworkId', [])).toLowerCase();
    if (this.#config.network === 'main' && reported.includes('test')) {
      throw new DriverError(
        `RPC node reports ${reported} but config says main`,
        'NETWORK_MISMATCH',
      );
    }
    if (this.#config.network === 'test' && reported.includes('main')) {
      throw new DriverError(
        `RPC node reports ${reported} but config says test`,
        'NETWORK_MISMATCH',
      );
    }
  }

  parseAddress(input: string): Address {
    const normalized = input.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!/^NQ[0-9]{2}(?: ?[0-9A-Z]{4}){8}$/.test(normalized)) {
      throw new DriverError(`Invalid Nimiq address: ${input}`, 'INVALID_ADDRESS');
    }
    return normalized as Address;
  }

  async getFaucetAddress(): Promise<Address> {
    return this.parseAddress(this.#config.walletAddress);
  }

  async getBalance(): Promise<bigint> {
    const account = await this.#rpc<{ balance: string | number }>('getAccountByAddress', [
      this.#config.walletAddress,
    ]);
    return BigInt(account.balance);
  }

  async send(to: Address, amount: bigint, memo?: string): Promise<TxId> {
    // Albatross requires an explicit validity-start-height on every tx. Using
    // the current head means the tx is valid for the next ~120 blocks.
    const validityStartHeight = await this.#rpc<number>('getBlockNumber', []);
    const value = Number(amount); // luna (1 NIM = 1e5 luna); claim amounts fit in number.
    const fee = 0;
    if (memo && memo.length > 0) {
      const data = Buffer.from(memo, 'utf8').toString('hex');
      const hash = await this.#rpc<string>('sendBasicTransactionWithData', [
        this.#config.walletAddress,
        to,
        data,
        value,
        fee,
        validityStartHeight,
      ]);
      return hash as TxId;
    }
    const hash = await this.#rpc<string>('sendBasicTransaction', [
      this.#config.walletAddress,
      to,
      value,
      fee,
      validityStartHeight,
    ]);
    return hash as TxId;
  }

  async waitForConfirmation(tx: TxId, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const receipt = await this.#rpc<{ confirmations?: number } | null>('getTransactionByHash', [tx]);
      if (receipt && typeof receipt.confirmations === 'number' && receipt.confirmations > 0) {
        return;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new DriverError(`Tx ${tx} not confirmed within ${timeoutMs}ms`, 'CONFIRM_TIMEOUT');
  }

  async addressHistory(address: Address): Promise<HistorySummary> {
    // Signature: (address, max, start_at). `start_at = null` starts from the tip.
    // Requires a history-indexed node (`index_history = true` in client.toml).
    const txs = await this.#rpc<Array<{ from: string; to: string; value: number; timestamp: number }>>(
      'getTransactionsByAddress',
      [address, 50, null],
    );
    let incomingCount = 0;
    let outgoingCount = 0;
    let totalReceived = 0n;
    let totalSent = 0n;
    let firstSeenAt: number | null = null;
    for (const tx of txs) {
      if (firstSeenAt === null || tx.timestamp < firstSeenAt) firstSeenAt = tx.timestamp;
      if (tx.to === address) {
        incomingCount++;
        totalReceived += BigInt(tx.value);
      } else if (tx.from === address) {
        outgoingCount++;
        totalSent += BigInt(tx.value);
      }
    }
    const isSweeper =
      incomingCount >= 3 && outgoingCount >= 1 && totalSent >= (totalReceived * 9n) / 10n;
    return { firstSeenAt, incomingCount, outgoingCount, totalReceived, totalSent, isSweeper };
  }

  async #rpc<T>(method: string, params: unknown[]): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.#config.auth) {
      const { username, password } = this.#config.auth;
      headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }
    const res = await request(this.#config.rpcUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: this.#nextId++, method, params }),
    });
    if (res.statusCode >= 400) {
      throw new DriverError(`RPC ${method} returned ${res.statusCode}`, 'RPC_HTTP_ERROR');
    }
    const body = (await res.body.json()) as RpcResponse<T>;
    if (body.error) {
      throw new DriverError(`RPC ${method} error: ${body.error.message}`, `RPC_${body.error.code}`);
    }
    if (body.result === undefined) {
      throw new DriverError(`RPC ${method} returned empty result`, 'RPC_EMPTY');
    }
    // Albatross wraps every successful result as `{ data, metadata }`.
    // Unwrap once here so every call-site sees the raw payload. If some
    // future node version returns a bare result, pass it through unchanged.
    if (
      body.result !== null &&
      typeof body.result === 'object' &&
      'data' in (body.result as object)
    ) {
      return (body.result as { data: T }).data;
    }
    return body.result as T;
  }
}

export const nimiqRpcFactory: CurrencyDriverFactory<NimiqRpcDriverConfig> = {
  id: 'nimiq-rpc',
  async create(config) {
    const d = new NimiqRpcDriver(config);
    return d;
  },
};
