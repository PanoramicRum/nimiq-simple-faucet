# React Native (Expo) faucet example

An Expo app that claims NIM from a self-hosted Nimiq faucet using
[`@nimiq-faucet/react-native`](../../packages/sdk-react-native) — the
`createReactNativeFaucetClient({ url })` client auto-injects the device
fingerprint from `react-native-device-info` on a native build (and degrades
gracefully on Expo Go / web). Single screen ([`App.tsx`](App.tsx)): an address
input, a claim button, live status + tx hash. Reads `/v1/config` and uses
`client.solveAndClaim()` when the faucet has hashcash enabled, `client.claim()`
otherwise.

> ## ⚠️ Running this from inside the monorepo: add `node-linker=hoisted`
>
> Expo/Metro can't resolve transitive dependencies (`expo-modules-core`, …) out
> of pnpm's default isolated `node_modules`, so to actually run this example —
> `expo start`, `expo start --web`, `expo export -p web`, `expo run:android` —
> you need pnpm's flat layout. Create a `.npmrc` at the repo root with:
>
> ```ini
> node-linker=hoisted
> ```
>
> then re-run `pnpm install`. This is the [Expo-recommended layout for pnpm
> monorepos](https://docs.expo.dev/guides/monorepos/). **This repo doesn't ship
> that `.npmrc` by default** because the flat layout collides with the
> workspace's mixed React versions (a few transitive `react@<19.2.6` deps);
> if you copy this example into your own project, align your `react` /
> `react-dom` to a single version. Without the `.npmrc` the example still
> type-checks (`pnpm --filter @nimiq-faucet/example-react-native build`) — it
> just won't bundle.

## Run

```bash
# from the repo root
echo 'node-linker=hoisted' > .npmrc      # see the note above
pnpm install
cp examples/react-native-claim-app/.env.example examples/react-native-claim-app/.env   # set EXPO_PUBLIC_FAUCET_URL
pnpm --filter @nimiq-faucet/example-react-native start
```

Then open the project in **Expo Go** (scan the QR), press `w` for the **web
preview** in a browser, or — for a native build with the real device
fingerprint — `npx expo run:android` / `npx expo run:ios` (or `npx expo
prebuild` first). Need a faucet to point at? See
[`deploy/compose/README.md`](../../deploy/compose/README.md).

> **Faucet URL & CORS.** `EXPO_PUBLIC_FAUCET_URL` must be reachable from the
> device/emulator and CORS-allowed by the faucet (`FAUCET_CORS_ORIGINS`). On an
> Android emulator use `http://10.0.2.2:8080`; on a physical device use your
> machine's LAN IP; for the web preview, `http://localhost:8080`.

## Device fingerprint — what runs where

| Target | `react-native-device-info` | `fingerprint.visitorId` |
|---|---|---|
| Native dev build (`expo run:*`, `expo prebuild`) | native module loads | real per-device id, auto-injected |
| Expo Go (`expo start`) | not available | omitted — SDK degrades gracefully |
| Web preview (`expo start --web`) | web shim / absent | omitted (or a placeholder) |

The `@nimiq-faucet/react-native` client resolves `react-native-device-info` at
runtime via Metro's `require`, inside a try/catch — so the example works in all
three cases; the fingerprint is just a no-op where the native module isn't there.

## Abuse layers

This example demonstrates the **device fingerprint** (auto-injected on dev
builds) and **hashcash** (`client.solveAndClaim()` does the proof-of-work when
`config.hashcash` is non-null), and passes an unsigned `hostContext: { uid }`
for the demo. It does **not** render a captcha widget — Cloudflare Turnstile /
hCaptcha are web widgets that need a `WebView` in React Native; if your faucet
requires a captcha the example will report it. The framework-agnostic recipe
for handling abuse layers (reading `/v1/config`, the captcha widget, signing a
`hostContext` from a backend) is in
[`docs/abuse-layers/integration-guide.md`](../../docs/abuse-layers/integration-guide.md).

## Files

[`App.tsx`](App.tsx) (the screen), [`index.ts`](index.ts) (`registerRootComponent`),
[`app.json`](app.json) (Expo config), [`metro.config.js`](metro.config.js)
(adds the workspace root to `watchFolders` so Metro serves the workspace
packages — `@nimiq-faucet/react-native` and `@nimiq-faucet/sdk`, consumed as
their built `dist/`), [`babel.config.js`](babel.config.js),
[`tsconfig.json`](tsconfig.json) (extends `expo/tsconfig.base`).
