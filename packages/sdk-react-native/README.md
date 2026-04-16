# @nimiq-faucet/react-native

React Native wrapper around `@nimiq-faucet/sdk`. Reads a stable device id from `react-native-device-info` and feeds it into `fingerprint.visitorId` on every claim.

## Install

```
pnpm add @nimiq-faucet/react-native react-native-device-info
```

Requires React Native 0.74+; RN's built-in `fetch` is used (no polyfill needed).

## Usage

```ts
import { createReactNativeFaucetClient } from '@nimiq-faucet/react-native';

const client = createReactNativeFaucetClient({ url: 'https://faucet.example.com' });
await client.claim(address); // fingerprint.visitorId = DeviceInfo.getUniqueIdSync()
```

Everything from `@nimiq-faucet/sdk` is re-exported. The wrapper degrades gracefully if `react-native-device-info` is absent.
