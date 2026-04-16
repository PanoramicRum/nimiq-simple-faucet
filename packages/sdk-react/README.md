# @nimiq-faucet/react

React hooks for the [Nimiq Simple Faucet](https://github.com/PanoramicRum/nimiq-simple-faucet), built on `@nimiq-faucet/sdk`.

## Install

```bash
npm install @nimiq-faucet/react
```

## Usage

```tsx
import { FaucetClient, useFaucetClaim } from '@nimiq-faucet/react';

const client = new FaucetClient({ url: 'https://faucet.example.com' });

function ClaimButton({ address }: { address: string }) {
  const { claim, status, txId, error } = useFaucetClaim({
    client,
    address,
    hostContext: { uid: hashedUserId, kycLevel: 'email' },
  });

  return (
    <button onClick={claim} disabled={status === 'pending'}>
      {status === 'confirmed' ? 'Sent!' : 'Claim NIM'}
    </button>
  );
}
```

## Hooks

- `useFaucetClaim({ client, address, hostContext? })` — manages the full claim lifecycle
- `useFaucetStatus(client, id, pollIntervalMs?)` — polls claim status
- `useFaucetStream(client, onEvent)` — WebSocket event subscription

## License

MIT
