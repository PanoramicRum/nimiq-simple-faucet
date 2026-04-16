# Capacitor

The `@nimiq-faucet/capacitor` package ships the TypeScript SDK plus a native
bridge that captures a stable device ID and forwards it in `hostContext`.

## Install

```bash
pnpm add @nimiq-faucet/capacitor
npx cap sync
```

Add the plugin to `capacitor.config.ts` if required by the Capacitor version
in use; recent versions auto-register.

## Add a claim button

```ts
import { FaucetClient } from '@nimiq-faucet/capacitor';

const client = new FaucetClient({
  url: import.meta.env.VITE_FAUCET_URL,
});

async function onClaim(address: string): Promise<void> {
  // Capacitor adds deviceIdHash, platform, osVersion under the hood.
  const { id } = await client.claim(address, {
    hostContext: { kycLevel: 'none' },
  });
  const { txId } = await client.waitForConfirmation(id);
  console.log('confirmed', txId);
}
```

The plugin populates the following `hostContext` fields automatically:

| Field | Source |
| --- | --- |
| `deviceIdHash` | `Device.getId()` hashed with the app's integrator id as salt. |
| `platform` | `Capacitor.getPlatform()` — `ios`, `android`, or `web`. |
| `osVersion` | `Device.getInfo().osVersion`. |

Anything you pass in explicit `hostContext` takes precedence.

## iOS permissions

No special entitlements needed; the bridge uses only `DeviceInfo`. Ensure your
`Info.plist` declares the network reach if you target iOS 17+.

## Live snippet URL

| Version | URL | Notes |
| --- | --- | --- |
| `latest` | [`examples/capacitor-mobile-app`](https://github.com/PanoramicRum/nimiq-simple-faucet/tree/main/examples/capacitor-mobile-app) | Working Capacitor + `@nimiq-faucet/capacitor` demo (web preview). |
