# Next.js Claim Page Example

Next.js 16 (App Router) app demonstrating `@nimiq-faucet/react` integration **with full abuse-layer support**: captcha widget, hashcash proof-of-work, and signed `hostContext`. Mirror of [`../vue-claim-page/`](../vue-claim-page/).

## What this demonstrates

- `FaucetClient` instantiation from `@nimiq-faucet/react`
- `/v1/config` discovery — the page renders the captcha widget the server is configured for, and runs hashcash if the server requires it
- Cloudflare Turnstile + hCaptcha widget integration (script loaded conditionally)
- Hashcash via `client.solveAndClaim()` with progress reporting
- `hostContext` shape (uid + the docs path for HMAC-signed contexts)
- Address input, claim submission, live status updates, error handling with retry

## Run locally

```bash
# From repo root
pnpm install
cp examples/nextjs-claim-page/.env.example examples/nextjs-claim-page/.env.local
# edit .env.local if your faucet isn't on http://localhost:8080
pnpm --filter @nimiq-faucet/example-nextjs dev
# Open http://localhost:3001
```

The faucet itself (compose stack, `local-node` profile) is described in [`deploy/compose/README.md`](../../deploy/compose/README.md).

## Run with Docker

```bash
# From repo root — starts faucet + this example
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up --build example-nextjs
# Open http://localhost:3001
```

## Abuse layers

Which layers actually run is decided by the faucet operator, not the page. The page reads `/v1/config` on mount and renders only the surfaces the server requires:

| Layer | Server enables via | Page shows |
|-------|-------------------|------------|
| **Cloudflare Turnstile** | `FAUCET_TURNSTILE_SITE_KEY` + `FAUCET_TURNSTILE_SECRET` | Cloudflare widget; token sent on `claim` as `captchaToken` |
| **hCaptcha** | `FAUCET_HCAPTCHA_SITE_KEY` + `FAUCET_HCAPTCHA_SECRET` | hCaptcha widget; token sent on `claim` as `captchaToken` |
| **Hashcash** | `FAUCET_HASHCASH_SECRET` (+ `FAUCET_HASHCASH_DIFFICULTY`) | "Proof-of-work: N attempts" progress text; `client.solveAndClaim()` does the round-trip |
| **`hostContext`** | always accepted (no env required) | uid demonstrated; signed-context pattern shown in code comments |
| **GeoIP / Fingerprint / On-chain / AI** | server-side only | invisible — no page changes needed |

Server-side details: [`docs/abuse-prevention.md`](../../docs/abuse-prevention.md) and the per-layer READMEs under [`packages/abuse-*`](../../packages/).

### Captcha provider

The page renders **either** Turnstile **or** hCaptcha — whichever the server returns from `/v1/config.captcha.provider`. Don't enable both server-side; the faucet picks one.

### Hashcash difficulty

`config.hashcash.difficulty` is read from `/v1/config`; the page surfaces it ("Hashcash difficulty 18 bits — solved in your browser"). 16 bits ≈ 65k hashes (~0.1s on a laptop), 20 bits ≈ 1M hashes (~1s), 24 bits ≈ 16M hashes (~15s). Tune for your bot/human ratio.

### `hostContext` signing — production deployments

The example sends a plain `{ uid: 'nextjs-example' }`. **In production**, every claim should carry a backend-signed hostContext so the faucet can trust the user-state fields (account age, KYC level, tags) you assert. With Next.js you can sign in a route handler and pass the result to the client component:

```ts
// app/api/host-context/route.ts (server-only)
import { FaucetClient } from '@nimiq-faucet/sdk';

export async function GET() {
  const signed = FaucetClient.signHostContext(
    { uid: 'user-123', accountAgeDays: 90, kycLevel: 'verified' },
    process.env.INTEGRATOR_ID!,
    process.env.FAUCET_HMAC_SECRET!,
  );
  return Response.json(signed);
}
```

The client component fetches `/api/host-context` and passes the result to `client.claim({ hostContext })`. The faucet verifies the HMAC and treats the asserted fields as load-bearing in the abuse pipeline. Without a signature, asserted fields are ignored. See [`packages/abuse-hostcontext/README.md`](../../packages/abuse-hostcontext/README.md).

## Project structure

```
nextjs-claim-page/
  app/
    layout.tsx     — root layout
    page.tsx       — claim UI + abuse-layer orchestration (client component)
    globals.css    — styles
  .env.example     — copy to .env.local
  package.json
  next.config.mjs
  tsconfig.json
  Dockerfile
```
