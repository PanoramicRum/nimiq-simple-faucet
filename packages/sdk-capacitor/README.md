# @nimiq-faucet/capacitor

Capacitor wrapper around `@nimiq-faucet/sdk`. Auto-populates `fingerprint.visitorId` from `@capacitor/device`'s `Device.getId()`.

## Install

```
pnpm add @nimiq-faucet/capacitor @capacitor/core @capacitor/device
```

## Usage

```ts
import { createCapacitorFaucetClient } from '@nimiq-faucet/capacitor';

const client = createCapacitorFaucetClient({ url: 'https://faucet.example.com' });
await client.claim(address); // fingerprint.visitorId auto-filled from Device.getId()
```

Caller-provided `fingerprint.visitorId` always wins. Everything else in `@nimiq-faucet/sdk` is re-exported (`FaucetClient`, `solveHashcash`, types).
