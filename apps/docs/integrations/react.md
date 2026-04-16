# React

The `@nimiq-faucet/react` package exposes a `useFaucetClaim` hook built on the
TypeScript SDK. Works with Create React App, Next.js (client components),
Vite, and Remix.

## Install

```bash
pnpm add @nimiq-faucet/react
```

## Add a claim button

```tsx
'use client';

import { useFaucetClaim } from '@nimiq-faucet/react';

interface ClaimButtonProps {
  address: string;
  uidHash?: string;
}

export function ClaimButton({ address, uidHash }: ClaimButtonProps) {
  const { claim, status, error, result } = useFaucetClaim({
    url: process.env.NEXT_PUBLIC_FAUCET_URL!,
    address,
    hostContext: { uid: uidHash, kycLevel: 'email' },
  });

  return (
    <button onClick={() => claim()} disabled={status === 'pending'}>
      {status === 'idle' && 'Claim free NIM'}
      {status === 'pending' && 'Claiming...'}
      {status === 'confirmed' && `Sent: ${result?.txId}`}
      {error && <span role="alert">{error.message}</span>}
    </button>
  );
}
```

## Provider (optional)

Wrap the tree once so every hook reuses the same client:

```tsx
import { FaucetProvider } from '@nimiq-faucet/react';

export function App({ children }: { children: React.ReactNode }) {
  return (
    <FaucetProvider url={process.env.NEXT_PUBLIC_FAUCET_URL!}>
      {children}
    </FaucetProvider>
  );
}
```

Then hooks pick up the URL automatically:

```tsx
const { claim } = useFaucetClaim({ address });
```

## SSR

`useFaucetClaim` is client-only. In Next.js, mark the file with
`'use client'`. Fetch `/v1/config` server-side if you need the active captcha
provider at render time.

## Live snippet URL

| Version | URL | Notes |
| --- | --- | --- |
| `latest` | [`examples/nextjs-claim-page`](https://github.com/PanoramicRum/nimiq-simple-faucet/tree/main/examples/nextjs-claim-page) | Working Next.js + `@nimiq-faucet/react` demo with Dockerfile. |
