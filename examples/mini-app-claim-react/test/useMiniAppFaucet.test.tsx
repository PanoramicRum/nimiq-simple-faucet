/**
 * State-machine tests for `useMiniAppFaucet`. Closes #142 (React half).
 *
 * Mirrors the Vue tests in shape so the two stay diff-able. Mocks the
 * same boundaries: FaucetClient + the Mini App SDK bridge.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const mockClient = {
  config: vi.fn(),
  claim: vi.fn(),
  waitForConfirmation: vi.fn(),
};
const mockBridge = {
  connectMiniApp: vi.fn(),
  getUserAddress: vi.fn(),
};

vi.mock('@nimiq-faucet/sdk', () => ({
  FaucetClient: vi.fn().mockImplementation(function FaucetClient() {
    return mockClient;
  }),
}));

vi.mock('@nimiq-faucet/mini-app-claim-shared', () => ({
  connectMiniApp: (...args: unknown[]) =>
    (mockBridge.connectMiniApp as (...a: unknown[]) => unknown)(...args),
  getUserAddress: (...args: unknown[]) =>
    (mockBridge.getUserAddress as (...a: unknown[]) => unknown)(...args),
}));

const { useMiniAppFaucet } = await import('../src/hooks/useMiniAppFaucet');

const ADDRESS = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';
const FAUCET_URL = 'http://localhost:8080';

beforeEach(() => {
  vi.clearAllMocks();
});

function setupReady() {
  mockBridge.connectMiniApp.mockResolvedValue({
    status: 'ready',
    provider: { listAccounts: vi.fn() },
  });
  mockBridge.getUserAddress.mockResolvedValue(ADDRESS);
}

describe('useMiniAppFaucet (React) — state machine', () => {
  it('happy path: ready → confirmed', async () => {
    setupReady();
    mockClient.config.mockResolvedValue({});
    mockClient.claim.mockResolvedValue({ id: 'cid-1', txId: 'tx-1', status: 'pending' });
    mockClient.waitForConfirmation.mockResolvedValue({ status: 'confirmed', txId: 'tx-1' });

    const { result } = renderHook(() => useMiniAppFaucet(FAUCET_URL));
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));

    await act(async () => { await result.current.claim(); });
    expect(result.current.state.phase).toBe('confirmed');
    expect(result.current.state.txId).toBe('tx-1');
    expect(result.current.state.address).toBe(ADDRESS);
  });

  it('outside-nimiq-pay sets phase + reason', async () => {
    mockBridge.connectMiniApp.mockResolvedValue({ status: 'outside-nimiq-pay', reason: 'no SDK' });

    const { result } = renderHook(() => useMiniAppFaucet(FAUCET_URL));
    await waitFor(() => expect(result.current.state.phase).toBe('outside-nimiq-pay'));
    expect(result.current.state.outsideReason).toBe('no SDK');
  });

  it('rejected at submit', async () => {
    setupReady();
    mockClient.config.mockResolvedValue({});
    mockClient.claim.mockResolvedValue({ id: 'cid-2', status: 'rejected', reason: 'rate limited' });

    const { result } = renderHook(() => useMiniAppFaucet(FAUCET_URL));
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    await act(async () => { await result.current.claim(); });
    expect(result.current.state.phase).toBe('rejected');
    expect(result.current.state.errorMessage).toBe('rate limited');
    expect(mockClient.waitForConfirmation).not.toHaveBeenCalled();
  });

  it('challenged response', async () => {
    setupReady();
    mockClient.config.mockResolvedValue({});
    mockClient.claim.mockResolvedValue({ id: 'cid-3', status: 'challenged', reason: 'captcha required' });

    const { result } = renderHook(() => useMiniAppFaucet(FAUCET_URL));
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    await act(async () => { await result.current.claim(); });
    expect(result.current.state.phase).toBe('challenged');
    expect(result.current.state.errorMessage).toBe('captcha required');
  });

  it('network error during claim → error phase', async () => {
    setupReady();
    mockClient.config.mockResolvedValue({});
    mockClient.claim.mockRejectedValue(new Error('ECONNREFUSED'));

    const { result } = renderHook(() => useMiniAppFaucet(FAUCET_URL));
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    await act(async () => { await result.current.claim(); });
    expect(result.current.state.phase).toBe('error');
    expect(result.current.state.errorMessage).toBe('ECONNREFUSED');
  });

  it('re-entry guard: second synchronous claim() is a no-op', async () => {
    setupReady();
    mockClient.config.mockResolvedValue({});
    let resolveClaim!: (v: { id: string; txId: string; status: 'pending' }) => void;
    mockClient.claim.mockReturnValue(
      new Promise((res) => { resolveClaim = res; }),
    );
    mockClient.waitForConfirmation.mockResolvedValue({ status: 'confirmed', txId: 'tx-4' });

    const { result } = renderHook(() => useMiniAppFaucet(FAUCET_URL));
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));

    let firstPromise!: Promise<void>;
    let secondPromise!: Promise<void>;
    await act(async () => {
      firstPromise = result.current.claim();
      secondPromise = result.current.claim();
      await Promise.resolve();
    });

    expect(mockBridge.getUserAddress).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveClaim({ id: 'cid-4', txId: 'tx-4', status: 'pending' });
      await Promise.all([firstPromise, secondPromise]);
    });
    expect(result.current.state.phase).toBe('confirmed');
  });
});
