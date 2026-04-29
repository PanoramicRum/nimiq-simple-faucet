/**
 * State-machine tests for `useMiniAppFaucet`. Closes #142 (Vue half).
 *
 * The composable uses only `reactive`/`ref`/`shallowRef`/`computed` (no
 * lifecycle hooks), so we can call it directly inside an `effectScope`
 * without mounting a component. The boundaries we mock are:
 *
 *   - `@nimiq-faucet/sdk`'s `FaucetClient` — the network layer.
 *   - `@nimiq-faucet/mini-app-claim-shared`'s `connectMiniApp` /
 *     `getUserAddress` — the Mini App SDK bridge.
 *
 * `fetchCaptchaToken` resolves through the `captchaPrompt` ref, so tests
 * that exercise the captcha branch satisfy it by calling
 * `captchaPrompt.value!.resolve('tok')` from the test body.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope, nextTick } from 'vue';

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
  FaucetClient: vi.fn().mockImplementation(() => mockClient),
}));

vi.mock('@nimiq-faucet/mini-app-claim-shared', () => ({
  connectMiniApp: (...args: unknown[]) =>
    (mockBridge.connectMiniApp as (...a: unknown[]) => unknown)(...args),
  getUserAddress: (...args: unknown[]) =>
    (mockBridge.getUserAddress as (...a: unknown[]) => unknown)(...args),
}));

// Imported AFTER vi.mock — vitest hoists vi.mock above all imports
// automatically, but staying explicit makes the intent obvious.
const { useMiniAppFaucet } = await import('../src/composables/useMiniAppFaucet');

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

async function flushMicrotasks() {
  // Two `nextTick`s drain the connectMiniApp `.then` continuation and the
  // subsequent reactive flush triggered by the assignment to state.phase.
  await nextTick();
  await nextTick();
}

describe('useMiniAppFaucet (Vue) — state machine', () => {
  it('happy path: ready → confirmed', async () => {
    setupReady();
    mockClient.config.mockResolvedValue({});
    mockClient.claim.mockResolvedValue({ id: 'cid-1', txId: 'tx-1', status: 'pending' });
    mockClient.waitForConfirmation.mockResolvedValue({ status: 'confirmed', txId: 'tx-1' });

    const scope = effectScope();
    const result = scope.run(() => useMiniAppFaucet(FAUCET_URL))!;
    await flushMicrotasks();
    expect(result.state.phase).toBe('ready');

    await result.claim();
    expect(result.state.phase).toBe('confirmed');
    expect(result.state.txId).toBe('tx-1');
    expect(result.state.address).toBe(ADDRESS);
    scope.stop();
  });

  it('outside-nimiq-pay sets phase + reason', async () => {
    mockBridge.connectMiniApp.mockResolvedValue({ status: 'outside-nimiq-pay', reason: 'no SDK' });

    const scope = effectScope();
    const result = scope.run(() => useMiniAppFaucet(FAUCET_URL))!;
    await flushMicrotasks();
    expect(result.state.phase).toBe('outside-nimiq-pay');
    expect(result.state.outsideReason).toBe('no SDK');
    scope.stop();
  });

  it('rejected at submit', async () => {
    setupReady();
    mockClient.config.mockResolvedValue({});
    mockClient.claim.mockResolvedValue({ id: 'cid-2', status: 'rejected', reason: 'rate limited' });

    const scope = effectScope();
    const result = scope.run(() => useMiniAppFaucet(FAUCET_URL))!;
    await flushMicrotasks();
    await result.claim();
    expect(result.state.phase).toBe('rejected');
    expect(result.state.errorMessage).toBe('rate limited');
    expect(mockClient.waitForConfirmation).not.toHaveBeenCalled();
    scope.stop();
  });

  it('challenged response', async () => {
    setupReady();
    mockClient.config.mockResolvedValue({});
    mockClient.claim.mockResolvedValue({ id: 'cid-3', status: 'challenged', reason: 'captcha required' });

    const scope = effectScope();
    const result = scope.run(() => useMiniAppFaucet(FAUCET_URL))!;
    await flushMicrotasks();
    await result.claim();
    expect(result.state.phase).toBe('challenged');
    expect(result.state.errorMessage).toBe('captcha required');
    scope.stop();
  });

  it('network error during claim → error phase', async () => {
    setupReady();
    mockClient.config.mockResolvedValue({});
    mockClient.claim.mockRejectedValue(new Error('ECONNREFUSED'));

    const scope = effectScope();
    const result = scope.run(() => useMiniAppFaucet(FAUCET_URL))!;
    await flushMicrotasks();
    await result.claim();
    expect(result.state.phase).toBe('error');
    expect(result.state.errorMessage).toBe('ECONNREFUSED');
    scope.stop();
  });

  it('re-entry guard: second synchronous claim() is a no-op', async () => {
    setupReady();
    mockClient.config.mockResolvedValue({});
    // Hold the claim mid-flight on a controllable promise.
    let resolveClaim!: (v: { id: string; txId: string; status: 'pending' }) => void;
    mockClient.claim.mockReturnValue(
      new Promise((res) => { resolveClaim = res; }),
    );

    const scope = effectScope();
    const result = scope.run(() => useMiniAppFaucet(FAUCET_URL))!;
    await flushMicrotasks();

    const first = result.claim();
    const second = result.claim();
    await Promise.resolve(); // microtask hop

    // Second call exited via the inFlight guard → only ONE getUserAddress.
    expect(mockBridge.getUserAddress).toHaveBeenCalledTimes(1);

    resolveClaim({ id: 'cid-4', txId: 'tx-4', status: 'pending' });
    mockClient.waitForConfirmation.mockResolvedValue({ status: 'confirmed', txId: 'tx-4' });
    await Promise.all([first, second]);
    expect(result.state.phase).toBe('confirmed');
    scope.stop();
  });
});
