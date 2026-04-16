import {
  DriverError,
  type Address,
  type CurrencyDriver,
  type CurrencyDriverFactory,
  type HistorySummary,
  type NetworkId,
  type TxId,
} from '@faucet/core';

export interface NimiqWasmDriverConfig {
  network: NetworkId;
  /** Seed phrase or hex-encoded private key. Supplied already decrypted by the server. */
  privateKey: string;
  /** Optional explicit peers / seed list override. Otherwise defaults from @nimiq/core are used. */
  seedPeers?: string[] | undefined;
}

type NimiqModule = typeof import('@nimiq/core');
// `Client` and `KeyPair` have private/wasm-generated constructors, so `InstanceType`
// can't name them directly; pull the instance type off a static factory return.
type NimiqClient = Awaited<ReturnType<NimiqModule['Client']['create']>>;
type NimiqKeyPair = ReturnType<NimiqModule['KeyPair']['generate']>;
type PlainTransactionDetails = Awaited<ReturnType<NimiqClient['getTransaction']>>;

/**
 * Thin wrapper around `@nimiq/core` (Web Client, compiled to WASM).
 *
 * The WASM client is loaded lazily to keep the package importable in tools that
 * do not support top-level await and to avoid spinning up a worker thread at
 * module-load time.
 */
export class NimiqWasmDriver implements CurrencyDriver {
  readonly id = 'nimiq';
  readonly networks: readonly NetworkId[] = ['main', 'test'];

  #config: NimiqWasmDriverConfig;
  #nimiq: NimiqModule | null = null;
  #client: NimiqClient | null = null;
  #keyPair: NimiqKeyPair | null = null;
  #networkIdNum: number | null = null;
  #addressCache: Address | null = null;

  constructor(config: NimiqWasmDriverConfig) {
    this.#config = config;
  }

  async init(): Promise<void> {
    try {
      // Dynamic import so importing this package doesn't immediately spin up
      // the Nimiq worker thread / WASM crypto module.
      const nimiq = (await import('@nimiq/core')) as NimiqModule;
      this.#nimiq = nimiq;

      const config = new nimiq.ClientConfiguration();
      config.network(this.#config.network === 'main' ? 'MainAlbatross' : 'TestAlbatross');
      if (this.#config.seedPeers && this.#config.seedPeers.length > 0) {
        config.seedNodes(this.#config.seedPeers);
      }

      const client = await nimiq.Client.create(config.build());
      this.#client = client;

      this.#keyPair = this.#deriveKeyPair(nimiq, this.#config.privateKey);
      const addr = this.#keyPair.toAddress();
      this.#addressCache = addr.toUserFriendlyAddress() as Address;

      await client.waitForConsensusEstablished();
      this.#networkIdNum = await client.getNetworkId();
    } catch (err) {
      if (err instanceof DriverError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new DriverError(`init failed: ${msg}`, 'INIT_FAILED');
    }
  }

  parseAddress(input: string): Address {
    const normalized = input.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!/^NQ[0-9]{2}(?: ?[0-9A-Z]{4}){8}$/.test(normalized)) {
      throw new DriverError(`Invalid Nimiq address: ${input}`, 'INVALID_ADDRESS');
    }
    if (this.#nimiq) {
      try {
        this.#nimiq.Address.fromUserFriendlyAddress(normalized);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new DriverError(`Invalid Nimiq address: ${msg}`, 'INVALID_ADDRESS');
      }
    }
    return normalized as Address;
  }

  async getFaucetAddress(): Promise<Address> {
    if (this.#addressCache) return this.#addressCache;
    throw new DriverError('Driver not initialized', 'NOT_INITIALIZED');
  }

  async getBalance(): Promise<bigint> {
    const { client, faucet } = this.#requireReady();
    try {
      const account = await client.getAccount(faucet);
      // PlainAccount always has a numeric `balance` field regardless of its `type`
      // (basic/vesting/htlc/staking). Balance is in luna (1 NIM = 1e5 luna).
      return BigInt((account as { balance: number }).balance);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DriverError(`getBalance failed: ${msg}`, 'BALANCE_FAILED');
    }
  }

  async send(to: Address, amount: bigint, memo?: string): Promise<TxId> {
    const { nimiq, client, keyPair, networkId } = this.#requireReady();
    try {
      const sender = keyPair.toAddress();
      const recipient = nimiq.Address.fromUserFriendlyAddress(this.parseAddress(to));
      const height = await client.getHeadHeight();

      const fee = 0n;
      const data = memo ? new TextEncoder().encode(memo) : null;
      const tx =
        data && data.length > 0
          ? nimiq.TransactionBuilder.newBasicWithData(
              sender,
              recipient,
              data,
              amount,
              fee,
              height,
              networkId,
            )
          : nimiq.TransactionBuilder.newBasic(sender, recipient, amount, fee, height, networkId);

      // `sign` mutates `tx.proof` in place; inner key pair is only used for staking txs.
      tx.sign(keyPair, undefined);

      const details = await client.sendTransaction(tx);
      return details.transactionHash as TxId;
    } catch (err) {
      if (err instanceof DriverError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new DriverError(`send failed: ${msg}`, 'SEND_FAILED');
    }
  }

  async waitForConfirmation(tx: TxId, timeoutMs = 60_000): Promise<void> {
    const { client } = this.#requireReady();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const details = await client.getTransaction(tx);
        if (details) {
          const state = details.state;
          const confirmations = details.confirmations ?? 0;
          if (state === 'confirmed' || state === 'included' || confirmations > 0) return;
          if (state === 'invalidated' || state === 'expired') {
            throw new DriverError(`Tx ${tx} ${state}`, 'TX_REJECTED');
          }
        }
      } catch (err) {
        if (err instanceof DriverError) throw err;
        // Transient "transaction not found yet" errors are expected while the tx is in mempool.
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new DriverError(`Tx ${tx} not confirmed within ${timeoutMs}ms`, 'CONFIRM_TIMEOUT');
  }

  async addressHistory(address: Address): Promise<HistorySummary> {
    const { client } = this.#requireReady();
    const parsed = this.parseAddress(address);
    let txs: PlainTransactionDetails[];
    try {
      txs = await client.getTransactionsByAddress(parsed, null, null, null, 50, null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DriverError(`addressHistory failed: ${msg}`, 'HISTORY_FAILED');
    }

    let incomingCount = 0;
    let outgoingCount = 0;
    let totalReceived = 0n;
    let totalSent = 0n;
    let firstSeenAt: number | null = null;
    for (const tx of txs) {
      // `timestamp` is milliseconds since epoch (PlainBlockCommonFields semantics).
      if (typeof tx.timestamp === 'number') {
        if (firstSeenAt === null || tx.timestamp < firstSeenAt) firstSeenAt = tx.timestamp;
      }
      const value = BigInt(tx.value);
      if (tx.recipient === parsed) {
        incomingCount++;
        totalReceived += value;
      } else if (tx.sender === parsed) {
        outgoingCount++;
        totalSent += value;
      }
    }
    const isSweeper =
      incomingCount >= 3 && outgoingCount >= 1 && totalSent >= (totalReceived * 9n) / 10n;
    return { firstSeenAt, incomingCount, outgoingCount, totalReceived, totalSent, isSweeper };
  }

  #requireReady(): {
    nimiq: NimiqModule;
    client: NimiqClient;
    keyPair: NimiqKeyPair;
    networkId: number;
    faucet: Address;
  } {
    if (
      !this.#nimiq ||
      !this.#client ||
      !this.#keyPair ||
      this.#networkIdNum === null ||
      !this.#addressCache
    ) {
      throw new DriverError('Driver not initialized', 'NOT_INITIALIZED');
    }
    return {
      nimiq: this.#nimiq,
      client: this.#client,
      keyPair: this.#keyPair,
      networkId: this.#networkIdNum,
      faucet: this.#addressCache,
    };
  }

  #deriveKeyPair(nimiq: NimiqModule, secret: string): NimiqKeyPair {
    const trimmed = secret.trim();
    // Accept a hex-encoded 32-byte private key or a BIP39 mnemonic seed phrase.
    // Anything else is rejected loudly rather than silently mis-derived.
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      const pk = nimiq.PrivateKey.fromHex(trimmed);
      return nimiq.KeyPair.derive(pk);
    }
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length === 12 || words.length === 24) {
      const entropy = nimiq.MnemonicUtils.mnemonicToEntropy(words);
      const extended = entropy.toExtendedPrivateKey();
      return nimiq.KeyPair.derive(extended.privateKey);
    }
    throw new DriverError(
      'privateKey must be a 64-char hex string or a 12/24-word mnemonic',
      'INVALID_PRIVATE_KEY',
    );
  }
}

export const nimiqWasmFactory: CurrencyDriverFactory<NimiqWasmDriverConfig> = {
  id: 'nimiq-wasm',
  async create(config) {
    const d = new NimiqWasmDriver(config);
    return d;
  },
};
