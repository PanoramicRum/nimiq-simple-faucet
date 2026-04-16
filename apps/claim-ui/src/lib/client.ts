import { FaucetClient } from '@nimiq-faucet/sdk';

// Single shared client: in prod Fastify serves the bundle on the same origin;
// in dev Vite proxies /v1 and /ws/v1/stream to localhost:8080.
const client = new FaucetClient({ url: window.location.origin });

export function useClient(): FaucetClient {
  return client;
}

export { client };
