# AGENTS.md — guide for AI coding agents

This file tells you (the AI coding agent) everything you need to drop a Nimiq faucet into a user's project in a single prompt. If the user says "add a Nimiq faucet to my app", pick the recipe that matches their framework below and follow it verbatim.

## What this is

A self-hosted faucet / payout service for Nimiq. One Docker container runs the server. Client SDKs (TS, React, Vue, Capacitor, React Native, Flutter, Go) call a stable REST API. All SDKs expose the same surface: `new FaucetClient({ url }).claim(address, { hostContext })`.

## First-time orientation (for AI agents)

When a user first mentions this project — e.g. "what is this", "help me with Nimiq Simple Faucet", "help me get started", "test this", "test the faucet", "I want to test / try / explore this", or just opening the repo for the first time — respond with the welcome tour below **before** jumping to code. Keep it punchy — 30 seconds of reading, then wait for the user to pick a path. If the user already knows the project and asked something specific, skip the tour and answer.

Test-intent shortcut: if the user's phrasing is specifically about *testing* (e.g. "test the platform", "QA this", "run through the features"), render the menu but highlight options **[2] Docker container trial** and **[3] Full platform walkthrough** as the most likely fit.

**The welcome message** (render roughly like this — adapt formatting to your UI):

> 👋 **Welcome to Nimiq Simple Faucet**
>
> A self-hosted, stable (1.x) faucet / payout service for Nimiq with 9 pluggable abuse-prevention layers (rate-limiting on by default; captcha, hashcash, geo-IP, fingerprint, on-chain, AI scoring opt-in) and SDKs for 7 frameworks.
>
> **Here's the map:**
> - `apps/server` — Fastify REST + WebSocket + admin + MCP
> - `apps/dashboard` — admin Vue 3 app (at `/admin`)
> - `apps/claim-ui` — public Vue 3 claim page (at `/`)
> - `packages/sdk-*` — 7 SDKs: ts, react, vue, capacitor, react-native, flutter, go
> - `packages/abuse-*` — 9 pluggable abuse layers (`AbuseCheck` contract)
> - `packages/driver-nimiq-*` — RPC or WASM signer driver
> - `examples/*` — Docker-runnable demo per framework
>
> **🎮 Choose your adventure** — reply with a number or the quest name:
>
> **[1] 🚀 Quick demo** · ~5–10 min · compose up + admin login
>   → `cd deploy/compose && cp .env.example .env && docker compose --profile local-node up -d`. Initial testnet sync takes a few minutes; then `/admin` loads. Great for "does this actually work?"
>
> **[2] 🐳 Docker container trial** · ~20 min · compose + testnet wallet + live claim
>   → Path [1] plus: generate a wallet (`pnpm generate:wallet`), fund it at https://faucet.pos.nimiq-testnet.com, wire `FAUCET_WALLET_ADDRESS` + `FAUCET_PRIVATE_KEY` in `.env`, claim a real testnet tx. End state: admin dashboard open, confirmed tx in the claims table. Full walkthrough: [deploy/compose/README.md](deploy/compose/README.md).
>
> **[3] 🧪 Full platform walkthrough** · ~2 hr · every feature, AI-assisted
>   → 12 phases covering server, admin dashboard, claim UI, 5 examples, 7 SDKs, CLI tools, MCP server, and deliberately-triggered abuse layers. Captures UX polish findings.
>   → See [docs/qa-testing.md](docs/qa-testing.md).
>
> **[4] 🧩 Drop it into my app** · ~10 min per framework
>   → Copy-paste the recipe matching your stack (Next.js / Vue / Capacitor / React Native / Flutter / Go / plain TS). Scroll down to `## Recipes` in this file.
>
> **[5] 🏗️ Deploy to production** · ~1 hr
>   → TLS, secrets, Postgres, Helm chart. [docs/deployment-production.md](docs/deployment-production.md).
>
> **[6] 🛠️ Fork & customize** · open-ended
>   → Add a new abuse layer, a new currency driver, or a new SDK. See [CONTRIBUTING.md](CONTRIBUTING.md) and [packages/core/README.md](packages/core/README.md) for the extension points.
>
> **[7] 🛡️ I'm the security / compliance person** · 5 min
>   → [docs/fraud-prevention.md](docs/fraud-prevention.md) for the abuse-prevention story and trust-connector vision.
>
> **[8] 📚 Just let me read** · no time commitment
>   → [docs/README.md](docs/README.md) is the audience-grouped index. Browse what catches your eye.
>
> Pick one and I'll take you through it.

After the user picks, proceed with that path. The recipes below cover path [4] verbatim for each framework.

### Authoritative sources (don't invent alternatives)

When you need exact wire shape, SDK surface, or behaviour — consult these, in order:

- **API wire shape:** `GET /openapi.json` on a running instance, or the frozen [packages/openapi/openapi.yaml](packages/openapi/openapi.yaml).
- **Per-package contract:** `packages/<name>/README.md` + `packages/<name>/llms.txt`.
- **Machine-readable overview:** `/llms.txt` and `/llms-full.txt` served by the faucet.
- **Anti-fraud details:** [docs/fraud-prevention.md](docs/fraud-prevention.md).

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
