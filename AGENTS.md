# AGENTS.md — guide for AI coding agents

This file tells you (the AI coding agent) everything you need to drop a Nimiq faucet into a user's project in a single prompt. If the user says "add a Nimiq faucet to my app", pick the recipe that matches their framework below and follow it verbatim.

## What this is

A self-hosted faucet / payout service for Nimiq. One Docker container runs the server. Client SDKs (TS, React, Vue, Capacitor, React Native, Flutter, Go) call a stable REST API. All SDKs expose the same surface: `new FaucetClient({ url }).claim(address, { hostContext })`.

## First-time orientation (for AI agents)

When a user first mentions this project ("what is this", "help me with Nimiq Simple Faucet", opening the repo for the first time, etc.), respond with a short welcome tour **before** jumping to code. The tour should cover:

1. **What it is** — one sentence: "A self-hosted, stable (1.x) faucet/payout service for Nimiq with strong abuse prevention and SDKs for 7 frameworks."

2. **What's here** — grouped repo layout:
   - `apps/server` — Fastify REST + WebSocket + admin + MCP
   - `apps/dashboard` — admin Vue 3 app (served at `/admin`)
   - `apps/claim-ui` — public Vue 3 claim page (served at `/`)
   - `apps/docs` — VitePress docs site
   - `packages/sdk-*` — 7 first-party SDKs (ts, react, vue, capacitor, react-native, flutter, go)
   - `packages/abuse-*` — 9 pluggable abuse layers (implement `AbuseCheck` from `@faucet/core`)
   - `packages/driver-nimiq-rpc` + `packages/driver-nimiq-wasm` — two signer drivers
   - `examples/*` — runnable Docker demos per framework
   - `docs/` — operator, integrator, maintainer, security, fraud-prevention docs

3. **Three common starting points** — offer these as options, pick the one matching the user's intent:
   - **"Run it locally"** → walk them through `docker compose -f deploy/compose/docker-compose.yml up -d` and [docs/admin-first-run.md](docs/admin-first-run.md).
   - **"Integrate into my app"** → jump to the right framework recipe in this file (below).
   - **"Test everything end-to-end"** → [docs/qa-testing.md](docs/qa-testing.md) — the 12-phase hands-on walkthrough, each phase AI-friendly.

4. **Where authoritative facts live** — do not invent alternatives. Authoritative sources:
   - API wire shape: `GET /openapi.json` on a running instance, or the frozen [packages/openapi/openapi.yaml](packages/openapi/openapi.yaml).
   - Per-package contract: `packages/<name>/README.md` + `packages/<name>/llms.txt`.
   - Machine-readable overview: `/llms.txt` and `/llms-full.txt` on the server.
   - Anti-fraud posture (for non-engineers asking about abuse prevention): [docs/fraud-prevention.md](docs/fraud-prevention.md).

Keep it short — 30 seconds of reading. If the user already knows the project and asked something specific, skip the tour and answer the specific question.

## Stable facts (do not invent alternatives)

- Server image: `ghcr.io/panoramicrum/nimiq-simple-faucet:latest`
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
go get github.com/PanoramicRum/nimiq-simple-faucet/packages/sdk-go
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
