# Vue Claim Page Example

Vue 3 + Vite app demonstrating `@nimiq-faucet/vue` integration **with full abuse-layer support**: captcha widget, hashcash proof-of-work, and signed `hostContext`.

## What this demonstrates

- `FaucetClient` instantiation from `@nimiq-faucet/vue`
- `/v1/config` discovery — the page renders the captcha widget the server is configured for, and runs hashcash if the server requires it
- Cloudflare Turnstile + hCaptcha widget integration (script loaded conditionally)
- Hashcash via `client.solveAndClaim()` with progress reporting
- `hostContext` shape (uid + the docs path for HMAC-signed contexts)
- Address input, claim submission, live status updates, error handling with retry

## Run locally

```bash
# From repo root
pnpm install
cp examples/vue-claim-page/.env.example examples/vue-claim-page/.env
# edit .env if your faucet isn't on http://localhost:8080
pnpm --filter @nimiq-faucet/example-vue dev
```

The faucet itself (compose stack, `local-node` profile) is described in [`deploy/compose/README.md`](../../deploy/compose/README.md).

## Run with Docker

```bash
# From repo root — starts faucet + this example
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up --build example-vue
# Open http://localhost:3002
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

The example sends a plain `{ uid: 'vue-example' }`. **In production**, every claim should carry a backend-signed hostContext so the faucet can trust the user-state fields (account age, KYC level, tags) you assert:

```ts
// On YOUR backend (Node.js):
import { FaucetClient } from '@nimiq-faucet/sdk';

const signed = FaucetClient.signHostContext(
  { uid: user.id, accountAgeDays: user.ageDays, kycLevel: 'verified' },
  process.env.INTEGRATOR_ID!,
  process.env.FAUCET_HMAC_SECRET!, // server-only
);
// Send `signed` to the browser; browser passes it to client.claim().
```

The faucet verifies the HMAC and treats the asserted fields as load-bearing in the abuse pipeline. Without a signature, asserted fields are ignored. See [`packages/abuse-hostcontext/README.md`](../../packages/abuse-hostcontext/README.md).

## Project structure

```
vue-claim-page/
  src/
    App.vue        — claim UI + abuse-layer orchestration
    main.ts        — app entry
    env.d.ts       — Vite env types
  index.html       — Vite HTML entry
  .env.example     — copy to .env
  package.json
  vite.config.ts
  tsconfig.json
  Dockerfile
  nginx.conf
```
