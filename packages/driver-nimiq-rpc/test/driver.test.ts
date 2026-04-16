import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverError } from '@faucet/core';

const requestMock = vi.fn();
vi.mock('undici', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import { NimiqRpcDriver } from '../src/index.js';

interface RpcCall {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params: unknown[];
}

/**
 * Albatross wraps every successful result as `{ data, metadata }`.
 * Our driver unwraps it, so every fixture here does the same.
 */
function mockResult<T>(data: T, metadata: unknown = null, statusCode = 200) {
  return {
    statusCode,
    body: { json: async () => ({ jsonrpc: '2.0', id: 1, result: { data, metadata } }) },
  };
}

function mockRpcError(code: number, message: string, statusCode = 200) {
  return {
    statusCode,
    body: { json: async () => ({ jsonrpc: '2.0', id: 1, error: { code, message } }) },
  };
}

function callsByMethod(method: string): RpcCall[] {
  return requestMock.mock.calls
    .map((call): RpcCall => JSON.parse((call[1] as { body: string }).body))
    .filter((c) => c.method === method);
}

const VALID_ADDR = 'NQ31 QAKA 1U1H C1BJ PQCK BL16 SL5V QL4G KTEV';

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NimiqRpcDriver — init', () => {
  it('accepts a matching-network getNetworkId response', async () => {
    requestMock.mockResolvedValueOnce(mockResult('TestAlbatross'));
    const d = new NimiqRpcDriver({
      network: 'test',
      rpcUrl: 'http://node.local',
      walletAddress: VALID_ADDR,
    });
    await expect(d.init()).resolves.toBeUndefined();
    expect(callsByMethod('getNetworkId').length).toBe(1);
  });

  it('throws NETWORK_MISMATCH when main config meets a testnet node', async () => {
    requestMock.mockResolvedValueOnce(mockResult('TestAlbatross'));
    const d = new NimiqRpcDriver({
      network: 'main',
      rpcUrl: 'http://node.local',
      walletAddress: VALID_ADDR,
    });
    await expect(d.init()).rejects.toMatchObject({
      name: 'DriverError',
      code: 'NETWORK_MISMATCH',
    });
  });

  it('throws NETWORK_MISMATCH when test config meets a mainnet node', async () => {
    requestMock.mockResolvedValueOnce(mockResult('MainAlbatross'));
    const d = new NimiqRpcDriver({
      network: 'test',
      rpcUrl: 'http://node.local',
      walletAddress: VALID_ADDR,
    });
    await expect(d.init()).rejects.toMatchObject({ code: 'NETWORK_MISMATCH' });
  });
});

describe('NimiqRpcDriver — parseAddress', () => {
  const d = new NimiqRpcDriver({
    network: 'test',
    rpcUrl: 'http://node.local',
    walletAddress: VALID_ADDR,
  });

  it('normalises a valid address', () => {
    expect(d.parseAddress(VALID_ADDR.toLowerCase())).toBe(VALID_ADDR);
    expect(d.parseAddress(VALID_ADDR.replace(/ /g, ''))).toBe(VALID_ADDR.replace(/ /g, ''));
  });

  it('rejects wrong prefix', () => {
    expect(() => d.parseAddress('XX31 QAKA 1U1H C1BJ PQCK BL16 SL5V QL4G KTEV')).toThrow(
      DriverError,
    );
  });

  it('rejects wrong length', () => {
    expect(() => d.parseAddress('NQ31 QAKA')).toThrow(DriverError);
  });

  it('rejects invalid characters', () => {
    expect(() => d.parseAddress('NQ31 QAKA 1U1H C1BJ PQCK BL16 SL5V QL4G KTE!')).toThrow(
      DriverError,
    );
  });
});

describe('NimiqRpcDriver — getBalance', () => {
  const baseCfg = {
    network: 'test' as const,
    rpcUrl: 'http://node.local',
    walletAddress: VALID_ADDR,
  };

  it('handles numeric balance (real Albatross shape)', async () => {
    requestMock.mockResolvedValueOnce(
      mockResult({ address: VALID_ADDR, balance: 12345, type: 'basic' }),
    );
    const d = new NimiqRpcDriver(baseCfg);
    await expect(d.getBalance()).resolves.toBe(12345n);
    const [send] = callsByMethod('getAccountByAddress');
    expect(send?.params).toEqual([VALID_ADDR]);
  });

  it('handles string balance (defensive)', async () => {
    requestMock.mockResolvedValueOnce(
      mockResult({ address: VALID_ADDR, balance: '987654321000', type: 'basic' }),
    );
    const d = new NimiqRpcDriver(baseCfg);
    await expect(d.getBalance()).resolves.toBe(987654321000n);
  });
});

describe('NimiqRpcDriver — send', () => {
  const baseCfg = {
    network: 'test' as const,
    rpcUrl: 'http://node.local',
    walletAddress: VALID_ADDR,
  };

  it('sends without memo: 5 positional args (from, to, value, fee, validityStartHeight)', async () => {
    requestMock
      .mockResolvedValueOnce(mockResult(48_000_000)) // getBlockNumber
      .mockResolvedValueOnce(mockResult('0xdeadbeef')); // sendBasicTransaction
    const d = new NimiqRpcDriver(baseCfg);
    const tx = await d.send(VALID_ADDR as never, 250n);
    expect(tx).toBe('0xdeadbeef');
    const [call] = callsByMethod('sendBasicTransaction');
    expect(call?.params).toEqual([VALID_ADDR, VALID_ADDR, 250, 0, 48_000_000]);
  });

  it('uses sendBasicTransactionWithData (6 args, memo as hex) when memo is set', async () => {
    requestMock
      .mockResolvedValueOnce(mockResult(100)) // getBlockNumber
      .mockResolvedValueOnce(mockResult('0xbeef')); // sendBasicTransactionWithData
    const d = new NimiqRpcDriver(baseCfg);
    await d.send(VALID_ADDR as never, 10n, 'hi');
    const [call] = callsByMethod('sendBasicTransactionWithData');
    expect(call?.params).toEqual([
      VALID_ADDR,
      VALID_ADDR,
      Buffer.from('hi', 'utf8').toString('hex'),
      10,
      0,
      100,
    ]);
    expect(callsByMethod('sendBasicTransaction').length).toBe(0);
  });

  it('treats empty memo as no memo', async () => {
    requestMock
      .mockResolvedValueOnce(mockResult(5))
      .mockResolvedValueOnce(mockResult('0xbeef'));
    const d = new NimiqRpcDriver(baseCfg);
    await d.send(VALID_ADDR as never, 100n, '');
    expect(callsByMethod('sendBasicTransaction').length).toBe(1);
    expect(callsByMethod('sendBasicTransactionWithData').length).toBe(0);
  });
});

describe('NimiqRpcDriver — waitForConfirmation', () => {
  const baseCfg = {
    network: 'test' as const,
    rpcUrl: 'http://node.local',
    walletAddress: VALID_ADDR,
  };

  it('resolves once confirmations > 0', async () => {
    requestMock.mockResolvedValueOnce(
      mockResult({ hash: '0xabc', confirmations: 1, blockNumber: 42 }),
    );
    const d = new NimiqRpcDriver(baseCfg);
    await expect(d.waitForConfirmation('0xabc' as never, 10_000)).resolves.toBeUndefined();
    expect(callsByMethod('getTransactionByHash').length).toBe(1);
  });

  it('throws CONFIRM_TIMEOUT when the deadline passes', async () => {
    requestMock.mockResolvedValue(
      mockResult({ hash: '0xabc', confirmations: 0, blockNumber: null }),
    );
    const d = new NimiqRpcDriver(baseCfg);
    await expect(d.waitForConfirmation('0xabc' as never, 1)).rejects.toMatchObject({
      code: 'CONFIRM_TIMEOUT',
    });
  });

  it('swallows transient "not found" errors and resolves once confirmed', async () => {
    // First poll: node returns RPC error (tx in mempool, not yet indexed).
    // Second poll: confirmations > 0.
    requestMock
      .mockResolvedValueOnce(mockRpcError(-32000, 'Transaction not found'))
      .mockResolvedValueOnce(mockResult({ hash: '0xabc', confirmations: 1, blockNumber: 42 }));
    const d = new NimiqRpcDriver(baseCfg);
    await expect(d.waitForConfirmation('0xabc' as never, 10_000)).resolves.toBeUndefined();
    expect(callsByMethod('getTransactionByHash').length).toBe(2);
  });
});

describe('NimiqRpcDriver — addressHistory', () => {
  const baseCfg = {
    network: 'test' as const,
    rpcUrl: 'http://node.local',
    walletAddress: VALID_ADDR,
  };

  it('calls getTransactionsByAddress with 3 args (addr, max, null)', async () => {
    const OTHER = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';
    requestMock.mockResolvedValueOnce(
      mockResult([
        { from: OTHER, to: VALID_ADDR, value: 1000, timestamp: 2 },
        { from: OTHER, to: VALID_ADDR, value: 1000, timestamp: 3 },
        { from: OTHER, to: VALID_ADDR, value: 1000, timestamp: 1 },
        { from: VALID_ADDR, to: OTHER, value: 2900, timestamp: 4 },
      ]),
    );
    const d = new NimiqRpcDriver(baseCfg);
    const h = await d.addressHistory(VALID_ADDR as never);
    const [call] = callsByMethod('getTransactionsByAddress');
    expect(call?.params).toEqual([VALID_ADDR, 50, null]);
    expect(h.incomingCount).toBe(3);
    expect(h.outgoingCount).toBe(1);
    expect(h.totalReceived).toBe(3000n);
    expect(h.totalSent).toBe(2900n);
    expect(h.firstSeenAt).toBe(1);
    expect(h.isSweeper).toBe(true);
  });

  it('does not flip isSweeper when outgoing is small', async () => {
    const OTHER = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';
    requestMock.mockResolvedValueOnce(
      mockResult([
        { from: OTHER, to: VALID_ADDR, value: 1000, timestamp: 1 },
        { from: OTHER, to: VALID_ADDR, value: 1000, timestamp: 2 },
        { from: OTHER, to: VALID_ADDR, value: 1000, timestamp: 3 },
        { from: VALID_ADDR, to: OTHER, value: 100, timestamp: 4 },
      ]),
    );
    const d = new NimiqRpcDriver(baseCfg);
    const h = await d.addressHistory(VALID_ADDR as never);
    expect(h.isSweeper).toBe(false);
  });
});

describe('NimiqRpcDriver — error surfacing', () => {
  const baseCfg = {
    network: 'test' as const,
    rpcUrl: 'http://node.local',
    walletAddress: VALID_ADDR,
  };

  it('maps RPC error.code into DriverError code', async () => {
    requestMock.mockResolvedValueOnce(mockRpcError(-32601, 'method not found'));
    const d = new NimiqRpcDriver(baseCfg);
    await expect(d.getBalance()).rejects.toMatchObject({ code: 'RPC_-32601' });
  });

  it('maps HTTP >=400 to RPC_HTTP_ERROR', async () => {
    requestMock.mockResolvedValueOnce({
      statusCode: 503,
      body: { json: async () => ({}) },
    });
    const d = new NimiqRpcDriver(baseCfg);
    await expect(d.getBalance()).rejects.toMatchObject({ code: 'RPC_HTTP_ERROR' });
  });

  it('maps empty result to RPC_EMPTY', async () => {
    requestMock.mockResolvedValueOnce({
      statusCode: 200,
      body: { json: async () => ({ jsonrpc: '2.0', id: 1 }) },
    });
    const d = new NimiqRpcDriver(baseCfg);
    await expect(d.getBalance()).rejects.toMatchObject({ code: 'RPC_EMPTY' });
  });

  it('passes through a non-wrapped result (back-compat)', async () => {
    // Some nodes / versions may not use the `{data, metadata}` envelope.
    requestMock.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: { address: VALID_ADDR, balance: 7, type: 'basic' },
        }),
      },
    });
    const d = new NimiqRpcDriver(baseCfg);
    await expect(d.getBalance()).resolves.toBe(7n);
  });
});

describe('NimiqRpcDriver — basic auth header', () => {
  it('attaches Basic auth when configured', async () => {
    requestMock.mockResolvedValueOnce(
      mockResult({ address: VALID_ADDR, balance: 0, type: 'basic' }),
    );
    const d = new NimiqRpcDriver({
      network: 'test',
      rpcUrl: 'http://node.local',
      walletAddress: VALID_ADDR,
      auth: { username: 'u', password: 'p' },
    });
    await d.getBalance();
    const [, opts] = requestMock.mock.calls[0] as [unknown, { headers: Record<string, string> }];
    expect(opts.headers.authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
  });
});
