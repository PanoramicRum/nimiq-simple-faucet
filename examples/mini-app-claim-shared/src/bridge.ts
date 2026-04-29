import { init, type NimiqProvider, type ErrorResponse } from '@nimiq/mini-app-sdk';

export type MiniAppConnectionState =
  | { status: 'connecting' }
  | { status: 'ready'; provider: NimiqProvider }
  | { status: 'outside-nimiq-pay'; reason: string };

export interface MiniAppConnection {
  /** Latest state observed; safe to read synchronously after `connect()` resolves. */
  state: MiniAppConnectionState;
}

/**
 * Initialise the Nimiq Pay provider. Resolves to `ready` if the SDK handshake
 * completes, or to `outside-nimiq-pay` after the timeout if the host wallet
 * never responds. Never throws — the example UI shows whatever state we land in.
 */
export async function connectMiniApp({ timeout = 10_000 }: { timeout?: number } = {}): Promise<MiniAppConnectionState> {
  try {
    const provider = await init({ timeout });
    return { status: 'ready', provider };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: 'outside-nimiq-pay', reason };
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return typeof value === 'object' && value !== null && 'error' in value;
}

/**
 * Ask the user (via Nimiq Pay's native confirmation dialog) for a NIM address.
 * MUST be called from a user gesture — calling on page load is an anti-pattern
 * (mini-apps-best-practices skill).
 *
 * Wraps `provider.listAccounts()` to throw on the SDK's `ErrorResponse` shape so
 * the call site stays idiomatic (no need to inspect `'error' in result`).
 */
export async function getUserAddress(provider: NimiqProvider): Promise<string> {
  const result = await provider.listAccounts();
  if (isErrorResponse(result)) {
    throw new Error(result.error.message || 'listAccounts failed');
  }
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error('No Nimiq addresses returned by Nimiq Pay');
  }
  const first = result[0];
  if (typeof first !== 'string') {
    throw new Error('Unexpected listAccounts response shape');
  }
  return first;
}
