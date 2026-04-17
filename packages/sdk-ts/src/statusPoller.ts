/**
 * Framework-agnostic claim status poller.
 */
import type { ClaimResponse } from './index.js';

export type FaucetStatusClient = {
  status(id: string): Promise<ClaimResponse>;
};

export interface StatusState {
  data: ClaimResponse | null;
  error: Error | null;
  loading: boolean;
}

export class StatusPoller {
  #client: FaucetStatusClient;
  #onChange: (state: StatusState) => void;
  #state: StatusState = { data: null, error: null, loading: false };
  #timer: ReturnType<typeof setInterval> | null = null;
  #tick = 0;

  constructor(client: FaucetStatusClient, onChange: (state: StatusState) => void) {
    this.#client = client;
    this.#onChange = onChange;
  }

  start(id: string, intervalMs = 2_000): void {
    this.stop();
    this.#poll(id);
    if (intervalMs > 0) {
      this.#timer = setInterval(() => this.#poll(id), intervalMs);
    }
  }

  async refetch(id: string): Promise<void> {
    await this.#poll(id);
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  destroy(): void {
    this.stop();
  }

  async #poll(id: string): Promise<void> {
    this.#set({ loading: true });
    const n = ++this.#tick;
    try {
      const next = await this.#client.status(id);
      if (n === this.#tick) this.#set({ data: next, loading: false });
    } catch (err) {
      if (n === this.#tick) this.#set({ error: err as Error, loading: false });
    }
  }

  #set(partial: Partial<StatusState>): void {
    Object.assign(this.#state, partial);
    this.#onChange({ ...this.#state });
  }
}
