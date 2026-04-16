import { describe, expect, it } from 'vitest';
import type { CurrencyDriver, HistorySummary } from '@faucet/core';
import { onchainNimiqCheck } from '../src/index.js';

function fakeDriver(overrides: Partial<CurrencyDriver> = {}): CurrencyDriver {
  const notImpl = () => {
    throw new Error('not implemented in fake');
  };
  return {
    id: 'fake-nimiq',
    networks: ['test'],
    init: async () => {},
    parseAddress: (s) => s,
    getFaucetAddress: async () => notImpl(),
    getBalance: async () => notImpl(),
    send: async () => notImpl(),
    waitForConfirmation: async () => notImpl(),
    ...overrides,
  };
}

const REQ = {
  address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
  ip: '10.0.0.1',
  requestedAt: Date.now(),
};

function hist(overrides: Partial<HistorySummary> = {}): HistorySummary {
  return {
    firstSeenAt: Date.now() - 30 * 86_400_000,
    incomingCount: 3,
    outgoingCount: 1,
    totalReceived: 1_000n,
    totalSent: 200n,
    isSweeper: false,
    ...overrides,
  };
}

describe('abuse-onchain-nimiq', () => {
  it('allows a healthy destination', async () => {
    const driver = fakeDriver({ addressHistory: async () => hist() });
    const result = await onchainNimiqCheck({ driver }).check(REQ);
    expect(result.decision).toBeUndefined();
    expect(result.score).toBe(0);
  });

  it('denies when the sweeper flag is set', async () => {
    const driver = fakeDriver({ addressHistory: async () => hist({ isSweeper: true }) });
    const result = await onchainNimiqCheck({ driver }).check(REQ);
    expect(result.decision).toBe('deny');
    expect(result.score).toBe(1);
    expect(result.reason).toMatch(/sweeper/);
  });

  it('soft-scores a fresh address with no prior activity', async () => {
    const driver = fakeDriver({
      addressHistory: async () =>
        hist({ firstSeenAt: null, incomingCount: 0, outgoingCount: 0, totalReceived: 0n, totalSent: 0n }),
    });
    const result = await onchainNimiqCheck({ driver, freshAddressBoostScore: 0.3 }).check(REQ);
    expect(result.decision).toBeUndefined();
    expect(result.score).toBe(0.3);
    expect(result.reason).toMatch(/no prior activity/);
  });

  it('soft-skips when the driver has no addressHistory method', async () => {
    const driver = fakeDriver();
    const result = await onchainNimiqCheck({ driver }).check(REQ);
    expect(result.score).toBe(0);
    expect(result.signals.skipped).toBe('no-history');
  });

  it('soft-skips when addressHistory throws', async () => {
    const driver = fakeDriver({
      addressHistory: async () => {
        throw new Error('rpc down');
      },
    });
    const result = await onchainNimiqCheck({ driver }).check(REQ);
    expect(result.score).toBe(0);
    expect(result.decision).toBeUndefined();
    expect(result.reason).toMatch(/soft-skip/);
    expect(result.signals.error).toBe('rpc down');
  });

  it('denies when destination was previously funded by a listed sibling faucet', async () => {
    const driver = fakeDriver({ addressHistory: async () => hist({ incomingCount: 2 }) });
    const result = await onchainNimiqCheck({
      driver,
      claimHistorySourceAddresses: ['NQ11 SIBL ING1 0000 0000 0000 0000 0000 0000'],
    }).check(REQ);
    expect(result.decision).toBe('deny');
    expect(result.reason).toMatch(/sibling faucet/);
  });
});
