# React Native

The `@nimiq-faucet/react-native` package bundles the TypeScript SDK with
`react-native-device-info` and ships a `useFaucetClaim` hook.

## Install

```bash
pnpm add @nimiq-faucet/react-native react-native-device-info
cd ios && pod install && cd ..
```

## Add a claim button

```tsx
import React from 'react';
import { Button, Text, View } from 'react-native';
import { useFaucetClaim } from '@nimiq-faucet/react-native';

export function ClaimButton({ address }: { address: string }) {
  const { claim, status, error, result } = useFaucetClaim({
    url: process.env.EXPO_PUBLIC_FAUCET_URL!,
    address,
    hostContext: { kycLevel: 'none' },
  });

  return (
    <View>
      <Button
        title={status === 'pending' ? 'Claiming...' : 'Claim free NIM'}
        onPress={() => claim()}
        disabled={status === 'pending'}
      />
      {status === 'confirmed' && <Text>Sent: {result?.txId}</Text>}
      {error && <Text accessibilityRole="alert">{error.message}</Text>}
    </View>
  );
}
```

The hook attaches `deviceIdHash`, `platform`, `osVersion`, and `appVersion`
to `hostContext` before sending.

## Expo

Works with Expo 50+ managed workflow. Add the package and
`react-native-device-info` via `expo install` to pick up the correct pods.

## Live snippet URL

| Version | URL | Notes |
| --- | --- | --- |
| `latest` | `/snippets/react-native` | TODO: generated at release (M9). |
