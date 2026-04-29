# mini-app-claim-shared

Framework-agnostic glue between [`@nimiq/mini-app-sdk`](https://www.npmjs.com/package/@nimiq/mini-app-sdk) and [`@nimiq-faucet/sdk`](../../packages/sdk-ts/), used by:

- [`mini-app-claim-vue/`](../mini-app-claim-vue/)
- [`mini-app-claim-react/`](../mini-app-claim-react/)

Currently a private workspace module under `examples/`. Once a third framework example exists (Svelte, vanilla, Solid, etc.) this graduates to `packages/mini-app-core/` and gets published as `@nimiq-faucet/mini-app`.

## What's in it

| Module | Purpose |
|---|---|
| `bridge.ts` | `connectMiniApp({ timeout })` (calls `init()`, never throws — returns a state) and `getUserAddress(provider)` (wraps `listAccounts()` and unwraps the SDK's `string[] \| ErrorResponse` return shape). |
| `fcaptcha.ts` | `loadFcaptcha({ serverUrl, siteKey, hostElement })` — framework-agnostic widget loader returning `{ token: Promise<string>, destroy }`. |
| `i18n.ts` | `translate(key, lang?)` — reads `getHostLanguage()` from the Mini App SDK; ships `en` + `de` strings. Per `mini-apps-best-practices`, never reads `navigator.language`. |

## Why it's not a published package yet

A two-framework example doesn't yet validate the API. Promoting prematurely creates a versioning burden. Wait until `pnpm --filter "./examples/mini-app-claim-*"` has at least three examples and the helper has survived contact with all of them, then graduate.
