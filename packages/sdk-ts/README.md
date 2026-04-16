# @nimiq-faucet/sdk

Framework-agnostic TypeScript client for the [Nimiq Simple Faucet](https://github.com/nimiq/simple-faucet). Works in browsers and Node.js.

## Install

```bash
npm install @nimiq-faucet/sdk
```

## Usage

```ts
import { FaucetClient } from '@nimiq-faucet/sdk';

const client = new FaucetClient({ url: 'https://faucet.example.com' });

// Simple claim
const { id } = await client.claim(address);
const result = await client.waitForConfirmation(id);

// With hashcash (auto-solves the challenge)
const result = await client.solveAndClaim(address, {
  hostContext: { uid: hashedUserId, kycLevel: 'email' },
});
```

## API

- `new FaucetClient({ url, apiKey?, hmacSecret? })` — construct a client
- `client.config()` — fetch faucet configuration
- `client.claim(address, options?)` — submit a claim
- `client.status(id)` — check claim status
- `client.requestChallenge(uid?)` — get a hashcash challenge
- `client.solveAndClaim(address, options?)` — end-to-end claim with hashcash
- `client.waitForConfirmation(id, timeoutMs?)` — poll until confirmed/rejected
- `client.subscribe(onEvent)` — WebSocket event stream
- `solveHashcash(challenge, difficulty)` — standalone hashcash solver

## License

MIT
