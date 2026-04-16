# AGENTS.md — guide for AI coding agents

This file tells you (the AI coding agent) everything you need to drop a Nimiq faucet into a user's project in a single prompt. If the user says "add a Nimiq faucet to my app", pick the recipe that matches their framework below and follow it verbatim.

## What this is

A self-hosted faucet / payout service for Nimiq. One Docker container runs the server. Client SDKs (TS, React, Vue, Capacitor, React Native, Flutter, Go) call a stable REST API. All SDKs expose the same surface: `new FaucetClient({ url }).claim(address, { hostContext })`.

## Stable facts (do not invent alternatives)

- Server image: `ghcr.io/nimiq/simple-faucet:latest`
- Default port: `8080`
- Admin UI: `GET /admin`
- Public claim endpoint: `POST /v1/claim`
- MCP endpoint: `/mcp` (HTTP+SSE)
- Discovery: `/llms.txt`, `/llms-full.txt`, `/openapi.json`
- Networks: `"main"` | `"test"` (env `FAUCET_NETWORK`)
- License: MIT

## Host-provided context (important)

Every SDK accepts a `hostContext` object. Forward whatever your user already has — it all feeds the faucet's abuse scoring and reduces false positives. All fields optional:

```ts
{
  uid: string;              // hashed stable user id
  cookieHash: string;       // hash of long-lived host cookie
  sessionHash: string;
  accountAgeDays: number;
  emailDomainHash: string;
  kycLevel: "none" | "email" | "phone" | "id";
  tags: string[];
  signature: string;        // HMAC(integratorSecret, canonical(context)) — server-side only
}
```

Unsigned contexts are weighted less. If the user's app has a backend, sign the context there and pass `signature` through to the client.

## Recipes

### Next.js / any React app

1. `pnpm add @nimiq-faucet/react`
2. Add to a client component:
   ```tsx
   import { useFaucetClaim } from '@nimiq-faucet/react';

   export function ClaimButton({ address }: { address: string }) {
     const { claim, status, error } = useFaucetClaim({
       url: process.env.NEXT_PUBLIC_FAUCET_URL!,
       address,
       hostContext: { uid: hashedUserId, kycLevel: 'email' },
     });
     return (
       <button onClick={claim} disabled={status === 'pending'}>
         {status === 'confirmed' ? 'Sent!' : 'Claim free NIM'}
         {error && <span>{error.message}</span>}
       </button>
     );
   }
   ```

### Vue 3 / Nuxt

1. `pnpm add @nimiq-faucet/vue`
2. ```vue
   <script setup lang="ts">
   import { useFaucetClaim } from '@nimiq-faucet/vue';
   const { claim, status } = useFaucetClaim({ url, address, hostContext });
   </script>
   ```

### Plain TypeScript (browser or Node)

```ts
import { FaucetClient } from '@nimiq-faucet/sdk';
const client = new FaucetClient({ url: 'https://faucet.example.com' });
const { id } = await client.claim(address, { hostContext });
const result = await client.waitForConfirmation(id);
```

### Capacitor

1. `pnpm add @nimiq-faucet/capacitor`
2. `npx cap sync`
3. Use the same `FaucetClient` API; device ID is captured automatically.

### React Native

1. `pnpm add @nimiq-faucet/react-native react-native-device-info`
2. Import `FaucetClient` from `@nimiq-faucet/react-native`.

### Flutter

1. `flutter pub add nimiq_faucet`
2. ```dart
   final client = FaucetClient(url: 'https://faucet.example.com');
   final claim = await client.claim(address, hostContext: {...});
   ```

### Go backend

```bash
go get github.com/nimiq/simple-faucet-go
```
```go
client := faucet.New(faucet.Config{URL: url, APIKey: key, HMACSecret: secret})
id, err := client.Claim(ctx, address, faucet.HostContext{UID: hashedUid})
```

## When you're unsure

- Need the exact schema? Fetch `${url}/openapi.json`.
- Need per-claim diagnostics? Call MCP tool `faucet.explain_decision(claimId)`.
- Need the full docs? Fetch `${url}/llms-full.txt`.

## Rules for agents editing this repo

- Do not break the `CurrencyDriver` interface in `@faucet/core` — every driver depends on it.
- Every new SDK must consume the generated OpenAPI spec; do not hand-write request models.
- New abuse providers go in `packages/abuse-*` and must implement the `AbuseCheck` interface exported from `@faucet/core`.
- Keep Nimiq-specific code inside `packages/driver-nimiq-*` and `packages/abuse-onchain-nimiq` only.
