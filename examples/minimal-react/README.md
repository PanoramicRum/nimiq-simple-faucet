# Minimal React faucet example

The smallest possible faucet integration: [`useFaucetClaim`](../../packages/sdk-react)
from `@nimiq-faucet/react` plus a button. Vite + React 19, no styling
framework, ~60 lines of app code ([`src/App.tsx`](src/App.tsx)). Copy this
directory into your project, point `VITE_FAUCET_URL` at your faucet, and you
have a working claim page.

```tsx
const { status, txId, error, claim, reset } = useFaucetClaim({
  client: { url: import.meta.env.VITE_FAUCET_URL },
  address,
});
// <button onClick={claim} disabled={!address}>Claim</button>
```

> **Heads-up — this example does *not* handle abuse layers.** If your faucet
> has a captcha (Cloudflare Turnstile / hCaptcha / FCaptcha) or hashcash
> proof-of-work enabled, a plain `claim()` comes back `challenged` or gets
> rejected. The framework-agnostic recipe for handling them — read
> `/v1/config`, render the captcha widget the server reports, use
> `client.solveAndClaim()` for hashcash, forward a signed `hostContext` —
> is in [`docs/abuse-layers/integration-guide.md`](../../docs/abuse-layers/integration-guide.md).
> For a full React implementation see
> [`examples/nextjs-claim-page/`](../nextjs-claim-page).

## Run

```bash
# from the repo root
pnpm install
cp examples/minimal-react/.env.example examples/minimal-react/.env   # edit if your faucet isn't on localhost:8080
pnpm --filter @nimiq-faucet/example-minimal-react dev
```

Need a faucet to point at? See [`deploy/compose/README.md`](../../deploy/compose/README.md)
(`docker compose --profile local-node up -d`).

## Run with Docker

```bash
# from the repo root — starts the faucet stack + this example
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up --build example-minimal-react
# → http://localhost:3008
```
