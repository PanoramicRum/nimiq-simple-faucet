/**
 * Framework-agnostic stream subscription manager.
 */

export type FaucetStreamClient = {
  subscribe(onEvent: (event: unknown) => void): () => void;
};

export class StreamManager {
  #client: FaucetStreamClient;
  #unsubscribe: (() => void) | null = null;

  constructor(client: FaucetStreamClient) {
    this.#client = client;
  }

  start(onEvent: (event: unknown) => void): void {
    this.stop();
    this.#unsubscribe = this.#client.subscribe(onEvent);
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  destroy(): void {
    this.stop();
  }
}
