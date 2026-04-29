# Contributing a Claim UI frontend

The faucet's Claim UI is **pluggable**: any static SPA can be served as the user-facing claim page by pointing the server at its `dist/` directory. The repo ships one default theme (Porcelain Vault) and the bundled-theme registry lets operators pick another at deploy time with a single env var. Community-contributed themes follow the same path.

This doc is the contract.

---

## 1. Frontend contract

You ship a directory containing:

- `index.html` — the SPA shell.
- Any number of static assets (JS, CSS, images, fonts) referenced from `index.html` with **relative or absolute-from-root** paths (e.g. `/assets/index-abc123.js`). Vite's default output works out of the box.
- That's it. The server doesn't care which framework or build tool produced the bundle.

### Routing

The server registers your `dist/` at `/` with [`@fastify/static`](https://github.com/fastify/fastify-static) and a not-found handler that returns your `index.html` for any non-API path. **SPA routing works out of the box** — `react-router`, `vue-router`, Next.js's App Router (in static-export mode), or hash-based routing all work.

The reserved prefixes the server keeps for itself: `/v1/`, `/admin/`, `/mcp`, `/healthz`, `/llms.txt`, `/readyz`, `/metrics`. Don't use those as your client-side routes; the server will return 404 / its own response there.

### What you must NOT do

- Embed secrets in the bundle. Browsers see the JS; treat anything in there as public.
- Hard-code a faucet URL. Read it from a config endpoint or build-time env (`VITE_FAUCET_URL` / `NEXT_PUBLIC_FAUCET_URL`).
- Hold the user's private key. The faucet sends NIM **to** an address the user types in or pastes; it doesn't sign anything on the user's behalf.

---

## 2. Faucet API surface to consume

Three endpoints cover the entire claim flow. The [`@nimiq-faucet/sdk`](../packages/sdk-ts) package is the recommended client; raw `fetch` works too.

### `GET /v1/config`

Returns the operator's current configuration:

```json
{
  "network": "test",
  "claimAmountLuna": "100000",
  "abuseLayers": { "turnstile": false, "hcaptcha": false, "hashcash": true, ... },
  "captcha": null,
  "hashcash": { "difficulty": 18, "ttlMs": 300000 }
}
```

Read this on mount. Render captcha widgets (when `captcha != null`) and surface hashcash difficulty (when `hashcash != null`). Don't render features the server didn't enable.

### `POST /v1/claim`

```json
{
  "address": "NQ00 ...",
  "captchaToken": "...",                 // optional; when /v1/config.captcha != null
  "hashcashSolution": "<challenge>#<nonce>",  // optional; when /v1/config.hashcash != null
  "fingerprint": { "visitorId": "..." }, // optional; mobile apps via @capacitor/device
  "hostContext": { "uid": "...", ... }   // optional; backend-signed in production
}
```

Use `client.solveAndClaim()` to handle the hashcash round-trip automatically. Returns `{ id, status, txId? }`. Possible statuses: `queued`, `broadcast`, `confirmed`, `rejected`, `challenged`.

### `GET /v1/claim/{id}`

Poll for status, or use `client.waitForConfirmation(id)`.

### Reference snippet (Vue 3)

```ts
import { ref, onMounted } from 'vue';
import { FaucetClient, type FaucetConfig } from '@nimiq-faucet/sdk';

const faucetUrl = import.meta.env.VITE_FAUCET_URL || window.location.origin;
const client = new FaucetClient({ url: faucetUrl });
const config = ref<FaucetConfig | null>(null);
const status = ref('idle');

onMounted(async () => { config.value = await client.config(); });

async function claim(address: string) {
  status.value = 'submitting';
  const result = await client.solveAndClaim(address, {
    hostContext: { uid: 'my-theme-name' },
  });
  const final = await client.waitForConfirmation(result.id);
  status.value = final.status;
}
```

The framework SDKs ([`@nimiq-faucet/vue`](../packages/sdk-vue), [`@nimiq-faucet/react`](../packages/sdk-react)) provide reactive wrappers. See the existing examples under [`examples/`](../examples) for full implementations across Vue, Next.js, Capacitor, Go, Python, Flutter.

---

## 3. Local development

```bash
# Clone the repo
git clone https://github.com/PanoramicRum/nimiq-simple-faucet
cd nimiq-simple-faucet
pnpm install

# Start the faucet (separate terminal)
cd deploy/compose && cp .env.example .env  # edit FAUCET_ADMIN_PASSWORD + wallet
docker compose --profile local-node up -d

# Start your theme's dev server
cd apps/<your-theme-slug>-ui
VITE_FAUCET_URL=http://localhost:8080 pnpm dev
```

Your theme runs on Vite's port (5173 by default); browser hits the faucet via `VITE_FAUCET_URL`. CORS is permissive by default in `FAUCET_DEV=1` mode.

---

## 4. Theme registration

When your theme builds cleanly and you've got a working claim flow, register it so operators can flip to it with `FAUCET_CLAIM_UI_THEME=<your-slug>`.

### a. Add to the workspace

[`pnpm-workspace.yaml`](../pnpm-workspace.yaml):

```yaml
packages:
  ...
  - 'apps/your-theme-slug-ui'
```

Your `apps/<your-theme-slug>-ui/package.json` should be:

```json
{
  "name": "@nimiq-faucet/<your-theme-slug>-ui",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "<typecheck && vite build>",
    "preview": "vite preview"
  }
}
```

### b. Register in the theme registry

[`apps/server/src/themes.ts`](../apps/server/src/themes.ts):

```ts
export const THEMES = {
  'porcelain-vault': { ... },
  'your-theme-slug': {
    displayName: 'Your Theme Display Name',
    description: 'One-sentence summary shown in logs and the future theme picker.',
    distFromRepoRoot: 'apps/your-theme-slug-ui/dist',
    distInImage: '/app/themes/your-theme-slug/dist',
  },
} as const satisfies Record<string, ThemeManifest>;
```

### c. Bundle into the production Docker image

[`deploy/docker/Dockerfile`](../deploy/docker/Dockerfile) — the multi-theme build COPYs every `apps/*-ui/dist` to `/app/themes/<slug>/dist` (PR #4 of the multi-theme rollout, see ROADMAP §3.0). Once that lands, your theme is bundled automatically by the wildcard.

---

## 5. Submission process

Open a PR with:

- **Title**: `feat(themes): add <Your Theme Display Name> claim UI (#<roadmap-issue>)`
- **Description**:
  - One-paragraph summary of the visual direction.
  - **At least one screenshot** (light + dark if both supported).
  - Confirmation that you tested an end-to-end testnet claim against a running faucet.
  - WCAG AA contrast confirmation on the address input + claim button.
- **Files**: the new `apps/<slug>-ui/` workspace + the `pnpm-workspace.yaml` + `apps/server/src/themes.ts` updates.
- **Out of scope** for the maintainer review: framework choice (Vue/React/Svelte/vanilla all welcome), aesthetic preferences (subjective), specific component-library choices.
- **In scope** for review: the contract above (no embedded secrets, no hard-coded URLs, doesn't use reserved prefixes), accessibility minimums, that the build produces a clean static `dist/`, and that the theme registry entry matches the actual paths.

---

## See also

- [`apps/claim-ui/`](../apps/claim-ui) — the default Porcelain Vault theme. Reference implementation for the contract.
- [`packages/sdk-ts/`](../packages/sdk-ts) — `FaucetClient` source. The single place to look for what the API actually does.
- [`examples/`](../examples) — six worked examples across Vue, Next.js, Capacitor, Go, Python, Flutter that demonstrate every abuse-layer integration. The `vue-claim-page` and `nextjs-claim-page` examples are the closest sibling shape to a claim-UI theme.
- [`ROADMAP.md`](../ROADMAP.md) §3.0 — the multi-theme rollout plan (NimiqPoW theme is the reference second theme; Hub-API integration follows).
