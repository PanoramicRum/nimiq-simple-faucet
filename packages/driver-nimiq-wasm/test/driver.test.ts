import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverError } from '@faucet/core';

/**
 * Hand-written fake of `@nimiq/core` exposing only the surface the driver
 * touches. Captures calls so assertions can inspect constructor args.
 */
const fake = vi.hoisted(() => {
  const state: {
    sendResult: { transactionHash: string };
    transactionByHash: unknown;
    transactionsByAddress: unknown[];
    balance: number;
    headHeight: number;
    networkId: number;
    consensusResolve: () => void;
    newBasicArgs: unknown[] | null;
    newBasicWithDataArgs: unknown[] | null;
    signedWithInner: unknown;
  } = {
    sendResult: { transactionHash: '0xsent' },
    transactionByHash: { state: 'confirmed', confirmations: 1 },
    transactionsByAddress: [],
    balance: 42,
    headHeight: 1_000,
    networkId: 5,
    consensusResolve: () => {},
    newBasicArgs: null,
    newBasicWithDataArgs: null,
    signedWithInner: undefined,
  };

  class FakeAddress {
    constructor(public user: string) {}
    toUserFriendlyAddress() {
      return this.user;
    }
    static fromUserFriendlyAddress(s: string) {
      if (/INVALID/.test(s)) throw new Error('bad checksum');
      return new FakeAddress(s);
    }
  }

  class FakePrivateKey {
    constructor(public hex: string) {}
    static fromHex(hex: string) {
      return new FakePrivateKey(hex);
    }
  }

  class FakeKeyPair {
    constructor(public pk: FakePrivateKey) {}
    static derive(pk: FakePrivateKey) {
      return new FakeKeyPair(pk);
    }
    static generate() {
      return new FakeKeyPair(new FakePrivateKey('00'.repeat(32)));
    }
    toAddress() {
      return new FakeAddress('NQ00 0000 0000 0000 0000 0000 0000 0000 0000');
    }
  }

  class FakeClientConfiguration {
    networkId: string | null = null;
    seeds: string[] = [];
    network(id: string) {
      this.networkId = id;
    }
    seedNodes(s: string[]) {
      this.seeds = s;
    }
    build() {
      return this;
    }
  }

  class FakeTx {
    proof: unknown = null;
    sign(keyPair: unknown, inner: unknown) {
      state.signedWithInner = inner;
      this.proof = keyPair;
    }
  }

  const TransactionBuilder = {
    newBasic: vi.fn((...args: unknown[]) => {
      state.newBasicArgs = args;
      return new FakeTx();
    }),
    newBasicWithData: vi.fn((...args: unknown[]) => {
      state.newBasicWithDataArgs = args;
      return new FakeTx();
    }),
  };

  const Client = {
    create: vi.fn(async (_cfg: unknown) => ({
      waitForConsensusEstablished: vi.fn(async () => state.consensusResolve()),
      getNetworkId: vi.fn(async () => state.networkId),
      getAccount: vi.fn(async (_a: unknown) => ({ type: 'basic', balance: state.balance })),
      getHeadHeight: vi.fn(async () => state.headHeight),
      sendTransaction: vi.fn(async (_tx: unknown) => state.sendResult),
      getTransaction: vi.fn(async (_h: string) => state.transactionByHash),
      getTransactionsByAddress: vi.fn(async (..._a: unknown[]) => state.transactionsByAddress),
    })),
  };

  const MnemonicUtils = {
    mnemonicToEntropy: vi.fn((_words: string[]) => ({
      toExtendedPrivateKey: () => ({ privateKey: new FakePrivateKey('from-mnemonic') }),
    })),
  };

  return {
    state,
    module: {
      ClientConfiguration: FakeClientConfiguration,
      Client,
      Address: FakeAddress,
      PrivateKey: FakePrivateKey,
      KeyPair: FakeKeyPair,
      TransactionBuilder,
      MnemonicUtils,
    },
  };
});

vi.mock('@nimiq/core', () => fake.module);

import { NimiqWasmDriver } from '../src/index.js';

const HEX_KEY = '0'.repeat(64);
const VALID_ADDR = 'NQ31 QAKA 1U1H C1BJ PQCK BL16 SL5V QL4G KTEV';

function newDriver(overrides: Partial<{ network: 'main' | 'test'; privateKey: string }> = {}) {
  return new NimiqWasmDriver({
    network: overrides.network ?? 'test',
    privateKey: overrides.privateKey ?? HEX_KEY,
  });
}

beforeEach(() => {
  fake.state.newBasicArgs = null;
  fake.state.newBasicWithDataArgs = null;
  fake.state.signedWithInner = 'not-set';
  fake.state.transactionByHash = { state: 'confirmed', confirmations: 1 };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NimiqWasmDriver — default seed peers per network', () => {
  // Before #35's resolution, the driver fell through to @nimiq/core's
  // bundled seed list (all mainnet) even when network was 'test',
  // which caused TestAlbatross peers to reject the handshake. Now we
  // default to the Nimiq maintainers' confirmed testnet seed.
  const captured: { seeds: string[] | null } = { seeds: null };
  const realCreate = fake.module.Client.create;

  beforeEach(() => {
    captured.seeds = null;
    fake.module.Client.create = vi.fn(async (cfg: unknown) => {
      captured.seeds = (cfg as { seeds: string[] }).seeds;
      return {
        waitForConsensusEstablished: vi.fn(async () => fake.state.consensusResolve()),
        getNetworkId: vi.fn(async () => fake.state.networkId),
        getAccount: vi.fn(async (_a: unknown) => ({ type: 'basic', balance: fake.state.balance })),
        getHeadHeight: vi.fn(async () => fake.state.headHeight),
        sendTransaction: vi.fn(async (_tx: unknown) => fake.state.sendResult),
        getTransaction: vi.fn(async (_h: string) => fake.state.transactionByHash),
        getTransactionsByAddress: vi.fn(async (..._a: unknown[]) => fake.state.transactionsByAddress),
      };
    });
  });

  afterEach(() => {
    fake.module.Client.create = realCreate;
  });

  it("network='test' with no seedPeers override uses the Nimiq testnet seed", async () => {
    const d = newDriver({ network: 'test' });
    await d.init();
    await d.readyPromise;
    expect(captured.seeds).toEqual(['/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss']);
  });

  it("network='main' with no seedPeers override leaves seeds empty (uses @nimiq/core defaults)", async () => {
    const d = newDriver({ network: 'main' });
    await d.init();
    await d.readyPromise;
    expect(captured.seeds).toEqual([]);
  });

  it('explicit seedPeers override wins over the per-network default', async () => {
    const d = new NimiqWasmDriver({
      network: 'test',
      privateKey: HEX_KEY,
      seedPeers: ['/dns4/custom.seed.example/tcp/443/wss'],
    });
    await d.init();
    await d.readyPromise;
    expect(captured.seeds).toEqual(['/dns4/custom.seed.example/tcp/443/wss']);
  });
});

describe('NimiqWasmDriver — parseAddress (no init)', () => {
  it('normalises a valid address', () => {
    const d = newDriver();
    expect(d.parseAddress(VALID_ADDR.toLowerCase())).toBe(VALID_ADDR);
  });

  it('rejects an invalid address', () => {
    const d = newDriver();
    expect(() => d.parseAddress('NOPE')).toThrow(DriverError);
  });
});

describe('NimiqWasmDriver — init + key derivation', () => {
  it('accepts 64-char hex', async () => {
    const d = newDriver({ privateKey: HEX_KEY });
    await expect(d.init()).resolves.toBeUndefined();
    await expect(d.getFaucetAddress()).resolves.toBe(
      'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
    );
  });

  it('accepts 12-word mnemonic', async () => {
    const d = newDriver({ privateKey: 'word '.repeat(12).trim() });
    await expect(d.init()).resolves.toBeUndefined();
  });

  it('accepts 24-word mnemonic', async () => {
    const d = newDriver({ privateKey: 'word '.repeat(24).trim() });
    await expect(d.init()).resolves.toBeUndefined();
  });

  it('rejects a garbage secret', async () => {
    const d = newDriver({ privateKey: 'not-hex-not-mnemonic' });
    await expect(d.init()).rejects.toMatchObject({ code: 'INVALID_PRIVATE_KEY' });
  });
});

describe('NimiqWasmDriver — calls before init', () => {
  it('getBalance throws NOT_INITIALIZED', async () => {
    const d = newDriver();
    await expect(d.getBalance()).rejects.toMatchObject({ code: 'NOT_INITIALIZED' });
  });

  it('getFaucetAddress throws NOT_INITIALIZED', async () => {
    const d = newDriver();
    await expect(d.getFaucetAddress()).rejects.toMatchObject({ code: 'NOT_INITIALIZED' });
  });
});

describe('NimiqWasmDriver — post-init operations', () => {
  it('getBalance returns a bigint', async () => {
    fake.state.balance = 999;
    const d = newDriver();
    await d.init();
    await expect(d.getBalance()).resolves.toBe(999n);
  });

  it('send without memo uses newBasic and passes captured networkId', async () => {
    fake.state.networkId = 5;
    fake.state.headHeight = 2222;
    const d = newDriver();
    await d.init();
    const tx = await d.send(VALID_ADDR as never, 500n);
    expect(tx).toBe('0xsent');
    expect(fake.state.newBasicArgs).not.toBeNull();
    expect(fake.state.newBasicWithDataArgs).toBeNull();
    // positional args: sender, recipient, amount, fee, height, networkId
    const args = fake.state.newBasicArgs as unknown[];
    expect(args[2]).toBe(500n);
    expect(args[3]).toBe(0n);
    expect(args[4]).toBe(2222);
    expect(args[5]).toBe(5);
    expect(fake.state.signedWithInner).toBeUndefined();
  });

  it('send with memo uses newBasicWithData and encodes memo as UTF-8', async () => {
    const d = newDriver();
    await d.init();
    await d.send(VALID_ADDR as never, 10n, 'hello');
    expect(fake.state.newBasicWithDataArgs).not.toBeNull();
    const args = fake.state.newBasicWithDataArgs as unknown[];
    expect(args[2]).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(args[2] as Uint8Array)).toBe('hello');
  });

  it("parseAddress after init validates via nimiq.Address", async () => {
    const d = newDriver();
    await d.init();
    expect(() => d.parseAddress(VALID_ADDR.replace('KTEV', 'INVALID'))).toThrow(DriverError);
  });
});

describe('NimiqWasmDriver — waitForConfirmation', () => {
  it('resolves when state === confirmed', async () => {
    fake.state.transactionByHash = { state: 'confirmed', confirmations: 0 };
    const d = newDriver();
    await d.init();
    await expect(d.waitForConfirmation('0xabc' as never, 5_000)).resolves.toBeUndefined();
  });

  it('resolves when state === included', async () => {
    fake.state.transactionByHash = { state: 'included', confirmations: 0 };
    const d = newDriver();
    await d.init();
    await expect(d.waitForConfirmation('0xabc' as never, 5_000)).resolves.toBeUndefined();
  });

  it('resolves when confirmations > 0 regardless of state', async () => {
    fake.state.transactionByHash = { state: 'pending', confirmations: 1 };
    const d = newDriver();
    await d.init();
    await expect(d.waitForConfirmation('0xabc' as never, 5_000)).resolves.toBeUndefined();
  });

  it('throws TX_REJECTED on invalidated', async () => {
    fake.state.transactionByHash = { state: 'invalidated', confirmations: 0 };
    const d = newDriver();
    await d.init();
    await expect(d.waitForConfirmation('0xabc' as never, 5_000)).rejects.toMatchObject({
      code: 'TX_REJECTED',
    });
  });

  it('throws TX_REJECTED on expired', async () => {
    fake.state.transactionByHash = { state: 'expired', confirmations: 0 };
    const d = newDriver();
    await d.init();
    await expect(d.waitForConfirmation('0xabc' as never, 5_000)).rejects.toMatchObject({
      code: 'TX_REJECTED',
    });
  });

  it('times out with CONFIRM_TIMEOUT', async () => {
    fake.state.transactionByHash = { state: 'pending', confirmations: 0 };
    const d = newDriver();
    await d.init();
    await expect(d.waitForConfirmation('0xabc' as never, 1)).rejects.toMatchObject({
      code: 'CONFIRM_TIMEOUT',
    });
  });
});

describe('NimiqWasmDriver — readiness (init/consensus split)', () => {
  it('init() resolves without waiting for consensus', async () => {
    // Latch consensus so it hangs until we release it.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.state.consensusResolve = () => {
      /* will be overridden via Client.create */
    };
    const realCreate = fake.module.Client.create;
    fake.module.Client.create = vi.fn(async (_cfg: unknown) => ({
      waitForConsensusEstablished: vi.fn(async () => gate),
      getNetworkId: vi.fn(async () => fake.state.networkId),
      getAccount: vi.fn(async () => ({ balance: fake.state.balance })),
      getHeadHeight: vi.fn(async () => fake.state.headHeight),
      sendTransaction: vi.fn(async () => fake.state.sendResult),
      getTransaction: vi.fn(async () => fake.state.transactionByHash),
      getTransactionsByAddress: vi.fn(async () => fake.state.transactionsByAddress),
    }));

    try {
      const d = newDriver();
      const t0 = Date.now();
      await d.init();
      expect(Date.now() - t0).toBeLessThan(200);
      expect(d.isReady()).toBe(false);

      // Release the consensus gate and await the readiness promise.
      release();
      await d.readyPromise;
      expect(d.isReady()).toBe(true);
    } finally {
      fake.module.Client.create = realCreate;
    }
  });

  it('getBalance awaits readyPromise before issuing the RPC call', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const getAccountMock = vi.fn(async () => ({ balance: 123 }));
    const realCreate = fake.module.Client.create;
    fake.module.Client.create = vi.fn(async (_cfg: unknown) => ({
      waitForConsensusEstablished: vi.fn(async () => gate),
      getNetworkId: vi.fn(async () => fake.state.networkId),
      getAccount: getAccountMock,
      getHeadHeight: vi.fn(async () => fake.state.headHeight),
      sendTransaction: vi.fn(async () => fake.state.sendResult),
      getTransaction: vi.fn(async () => fake.state.transactionByHash),
      getTransactionsByAddress: vi.fn(async () => fake.state.transactionsByAddress),
    }));

    try {
      const d = newDriver();
      await d.init();
      const balancePromise = d.getBalance();
      // Give the microtask queue a tick; the RPC must NOT have fired yet.
      await new Promise((r) => setImmediate(r));
      expect(getAccountMock).not.toHaveBeenCalled();

      release();
      await expect(balancePromise).resolves.toBe(123n);
      expect(getAccountMock).toHaveBeenCalledTimes(1);
    } finally {
      fake.module.Client.create = realCreate;
    }
  });
});

describe('NimiqWasmDriver — addressHistory', () => {
  it('flags sweeper pattern', async () => {
    const OTHER = 'NQ99 0000 0000 0000 0000 0000 0000 0000 0000';
    fake.state.transactionsByAddress = [
      { sender: OTHER, recipient: VALID_ADDR, value: 1000, timestamp: 3 },
      { sender: OTHER, recipient: VALID_ADDR, value: 1000, timestamp: 1 },
      { sender: OTHER, recipient: VALID_ADDR, value: 1000, timestamp: 2 },
      { sender: VALID_ADDR, recipient: OTHER, value: 2900, timestamp: 4 },
    ];
    const d = newDriver();
    await d.init();
    const h = await d.addressHistory(VALID_ADDR as never);
    expect(h.incomingCount).toBe(3);
    expect(h.outgoingCount).toBe(1);
    expect(h.totalReceived).toBe(3000n);
    expect(h.totalSent).toBe(2900n);
    expect(h.firstSeenAt).toBe(1);
    expect(h.isSweeper).toBe(true);
  });

  it('does not flag non-sweeper pattern', async () => {
    const OTHER = 'NQ99 0000 0000 0000 0000 0000 0000 0000 0000';
    fake.state.transactionsByAddress = [
      { sender: OTHER, recipient: VALID_ADDR, value: 1000, timestamp: 1 },
      { sender: OTHER, recipient: VALID_ADDR, value: 1000, timestamp: 2 },
      { sender: OTHER, recipient: VALID_ADDR, value: 1000, timestamp: 3 },
      { sender: VALID_ADDR, recipient: OTHER, value: 10, timestamp: 4 },
    ];
    const d = newDriver();
    await d.init();
    const h = await d.addressHistory(VALID_ADDR as never);
    expect(h.isSweeper).toBe(false);
  });
});
