import { request } from 'undici';
import {
  DriverError,
  isValidNimiqAddress,
  normalizeNimiqAddress,
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
  /**
   * Optional hex private key. When supplied together with
   * `walletPassphrase`, `init()` imports the key into the node's wallet
   * manager via `importRawKey` (gated on `listAccounts`) so the
   * operator doesn't have to manually prep the node. Omit when the
   * wallet is pre-imported out of band.
   */
  privateKey?: string | undefined;
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
  #ready = false;
  #readyPromise: Promise<void> | null = null;
  #healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: NimiqRpcDriverConfig) {
    this.#config = config;
  }

  /**
   * Synchronous setup — stores nothing, returns immediately. All RPC
   * contact (network sanity check, wallet import, wallet unlock) runs
   * in the background behind `readyPromise` so the Fastify listener can
   * bind before the RPC node is reachable. Without this decoupling, any
   * node slowness / temporary unavailability at boot crashes the faucet
   * container (or wedges it in a restart loop).
   */
  async init(): Promise<void> {
    this.#readyPromise = this.#initAsync();
    // Swallow the rejection on the stored promise — operational methods
    // re-await it and will see the real error there. Leaving it
    // unhandled would fire Node's `unhandledrejection`.
    this.#readyPromise.catch(() => {});
  }

  get readyPromise(): Promise<void> | undefined {
    return this.#readyPromise ?? undefined;
  }

  isReady(): boolean {
    return this.#ready;
  }

  async #initAsync(): Promise<void> {
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
    await this.#ensureWalletReady();
    this.#ready = true;
    this.#healthTimer = setInterval(() => void this.#probe(), 5_000);
  }

  async #probe(): Promise<void> {
    try {
      await this.#rpc<number>('getBlockNumber', []);
      this.#ready = true;
    } catch {
      this.#ready = false;
    }
  }

  async #ensureWalletReady(): Promise<void> {
    // Without a passphrase we can't unlock the wallet; assume the
    // operator has pre-imported + pre-unlocked it externally. This is
    // the pre-1.1.2 behaviour, preserved for externally-managed keys.
    if (!this.#config.walletPassphrase) return;

    const accounts = await this.#rpc<string[]>('listAccounts', []);
    const normalize = (a: string): string => a.toUpperCase().replace(/\s+/g, ' ').trim();
    const wanted = normalize(this.#config.walletAddress);
    const alreadyImported = accounts.some((a) => normalize(a) === wanted);

    if (!alreadyImported) {
      if (!this.#config.privateKey) {
        throw new DriverError(
          `Wallet ${this.#config.walletAddress} is not imported in the RPC node and no privateKey was supplied. Set FAUCET_PRIVATE_KEY or import the key manually via importRawKey.`,
          'WALLET_NOT_IMPORTED',
        );
      }
      try {
        await this.#rpc<string>('importRawKey', [
          this.#config.privateKey,
          this.#config.walletPassphrase,
        ]);
      } catch (err) {
        // Rewrap RPC-layer errors (including DriverError produced by
        // `#rpc` for non-200 JSON-RPC responses) into a domain-specific
        // code so callers don't have to pattern-match on `RPC_-NNNN`.
        const msg = err instanceof Error ? err.message : String(err);
        throw new DriverError(`importRawKey failed: ${msg}`, 'WALLET_IMPORT_FAILED');
      }
    }

    // `unlockAccount` is idempotent on Albatross — returns true whether
    // or not the account was already unlocked. Duration `null` = unlock
    // until the node restarts (what we want for a long-running faucet).
    try {
      await this.#rpc<boolean>('unlockAccount', [
        this.#config.walletAddress,
        this.#config.walletPassphrase,
        null,
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DriverError(`unlockAccount failed: ${msg}`, 'WALLET_UNLOCK_FAILED');
    }
  }

  parseAddress(input: string): Address {
    const normalized = normalizeNimiqAddress(input);
    if (!isValidNimiqAddress(normalized)) {
      throw new DriverError(`Invalid Nimiq address: ${input}`, 'INVALID_ADDRESS');
    }
    return normalized as Address;
  }

  async getFaucetAddress(): Promise<Address> {
    return this.parseAddress(this.#config.walletAddress);
  }

  async getBalance(): Promise<bigint> {
    if (this.#readyPromise) await this.#readyPromise;
    const account = await this.#rpc<{ balance: string | number }>('getAccountByAddress', [
      this.#config.walletAddress,
    ]);
    return BigInt(account.balance);
  }

  async send(to: Address, amount: bigint, memo?: string): Promise<TxId> {
    if (this.#readyPromise) await this.#readyPromise;
    try {
      return await this.#sendOnce(to, amount, memo);
    } catch (err) {
      // If the node lost the wallet unlock (e.g. node restarted while
      // faucet stayed running), re-import + re-unlock and retry once.
      if (err instanceof DriverError && this.#isRetryableRpcError(err)) {
        await this.#ensureWalletReady();
        return this.#sendOnce(to, amount, memo);
      }
      throw err;
    }
  }

  #isRetryableRpcError(err: DriverError): boolean {
    // The Nimiq node returns -32603 "Internal error" when the wallet is
    // locked, as well as "No unlocked wallet" in some versions. Treat
    // any internal RPC error during send as potentially a lost-lock and
    // attempt re-unlock before retrying.
    return err.code === 'RPC_-32603'
      || err.message.toLowerCase().includes('no unlocked wallet')
      || err.message.toLowerCase().includes('unlocked account');
  }

  async #sendOnce(to: Address, amount: bigint, memo?: string): Promise<TxId> {
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

  // Issue #84: default 180 s ≈ Albatross's 120-block validity window
  // (~120 s @ 1 s blocks) + a small finality buffer. The previous 60 s
  // default flipped still-valid in-flight txs to `timeout` whenever the
  // network slowed. Callers can still pass a shorter value for tests.
  async waitForConfirmation(tx: TxId, timeoutMs = 180_000): Promise<void> {
    if (this.#readyPromise) await this.#readyPromise;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const receipt = await this.#rpc<{ confirmations?: number } | null>('getTransactionByHash', [tx]);
        if (receipt && typeof receipt.confirmations === 'number' && receipt.confirmations > 0) {
          return;
        }
      } catch {
        // Transient "transaction not found yet" errors are expected while
        // the tx is in the mempool. Keep polling until deadline.
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new DriverError(`Tx ${tx} not confirmed within ${timeoutMs}ms`, 'CONFIRM_TIMEOUT');
  }

  async addressHistory(address: Address): Promise<HistorySummary> {
    if (this.#readyPromise) await this.#readyPromise;
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
