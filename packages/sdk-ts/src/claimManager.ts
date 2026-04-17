/**
 * Framework-agnostic claim lifecycle manager.
 *
 * Encapsulates the claim → poll → confirm/reject state machine so React
 * and Vue SDKs don't duplicate the business logic. Each framework wraps
 * this with its own reactivity primitives (useState / ref).
 */
import type { ClaimOptions, ClaimResponse, ClaimStatus } from './index.js';

export type FaucetClaimClient = {
  claim(address: string, options?: ClaimOptions): Promise<ClaimResponse>;
  waitForConfirmation(id: string, timeoutMs?: number): Promise<ClaimResponse>;
};

export interface ClaimState {
  status: 'idle' | 'pending' | ClaimStatus;
  id: string | null;
  txId: string | null;
  decision: ClaimResponse['decision'] | null;
  error: Error | null;
}

const INITIAL_STATE: ClaimState = {
  status: 'idle',
  id: null,
  txId: null,
  decision: null,
  error: null,
};

export class ClaimManager {
  #client: FaucetClaimClient;
  #onChange: (state: ClaimState) => void;
  #state: ClaimState = { ...INITIAL_STATE };
  #controller: AbortController | null = null;

  constructor(client: FaucetClaimClient, onChange: (state: ClaimState) => void) {
    this.#client = client;
    this.#onChange = onChange;
  }

  async claim(
    address: string,
    options?: Omit<ClaimOptions, 'signal'> & { pollForConfirmation?: boolean | undefined },
  ): Promise<void> {
    this.reset();
    this.#set({ status: 'pending' });
    this.#controller = new AbortController();
    try {
      const { pollForConfirmation = true, ...claimOpts } = options ?? {};
      const response = await this.#client.claim(address, {
        ...claimOpts,
        signal: this.#controller.signal,
      });
      this.#set({
        id: response.id,
        status: response.status,
        txId: response.txId ?? null,
        decision: response.decision ?? null,
      });
      if (pollForConfirmation && (response.status === 'broadcast' || response.status === 'queued')) {
        const confirmed = await this.#client.waitForConfirmation(response.id);
        this.#set({
          status: confirmed.status,
          txId: confirmed.txId ?? response.txId ?? null,
          decision: confirmed.decision ?? null,
        });
      }
    } catch (err) {
      this.#set({ error: err as Error, status: 'rejected' });
    } finally {
      this.#controller = null;
    }
  }

  reset(): void {
    this.#controller?.abort();
    this.#controller = null;
    this.#state = { ...INITIAL_STATE };
    this.#onChange(this.#state);
  }

  destroy(): void {
    this.#controller?.abort();
    this.#controller = null;
  }

  getState(): ClaimState {
    return { ...this.#state };
  }

  #set(partial: Partial<ClaimState>): void {
    Object.assign(this.#state, partial);
    this.#onChange({ ...this.#state });
  }
}
