# Minimal Vue faucet example

The smallest possible faucet integration: [`useFaucetClaim`](../../packages/sdk-vue)
from `@nimiq-faucet/vue` plus a button. Vite + Vue 3, no styling framework,
one small SFC ([`src/App.vue`](src/App.vue)). Copy this directory into your
project, point `VITE_FAUCET_URL` at your faucet, and you have a working claim
page.

```ts
const { status, txId, error, isPending, claim, reset } = useFaucetClaim({
  client: { url: import.meta.env.VITE_FAUCET_URL },
  get address() { return address.value; }, // args.address is read at claim time
});
// <button :disabled="!address" @click="claim">Claim</button>
```

> **Heads-up — this example does *not* handle abuse layers.** If your faucet
> has a captcha (Cloudflare Turnstile / hCaptcha / FCaptcha) or hashcash
> proof-of-work enabled, a plain `claim()` comes back `challenged` or gets
> rejected. The framework-agnostic recipe for handling them — read
> `/v1/config`, render the captcha widget the server reports, use
> `client.solveAndClaim()` for hashcash, forward a signed `hostContext` —
> is in [`docs/abuse-layers/integration-guide.md`](../../docs/abuse-layers/integration-guide.md).
> For a full Vue implementation see [`examples/vue-claim-page/`](../vue-claim-page).

## Run

```bash
# from the repo root
pnpm install
cp examples/minimal-vue/.env.example examples/minimal-vue/.env   # edit if your faucet isn't on localhost:8080
pnpm --filter @nimiq-faucet/example-minimal-vue dev
```

Need a faucet to point at? See [`deploy/compose/README.md`](../../deploy/compose/README.md)
(`docker compose --profile local-node up -d`).

## Run with Docker

```bash
# from the repo root — starts the faucet stack + this example
docker compose -f deploy/compose/docker-compose.yml -f examples/docker-compose.yml up --build example-minimal-vue
# → http://localhost:3009
```
