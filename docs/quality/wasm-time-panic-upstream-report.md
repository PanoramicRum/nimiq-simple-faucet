# Upstream report: `@nimiq/core` WASM panics with `'time not implemented on this platform'`

**Status**: open against this repo as [issue #119](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/119); not yet filed upstream.

**Hand-off target**: [`nimiq/core-rs-albatross`](https://github.com/nimiq/core-rs-albatross) (the `@nimiq/core` WASM client is built from this repo's web-client crate).

This file is the source-of-truth for the upstream report. The maintainer
copies the §"Report body" section into a new `core-rs-albatross` issue
and adds whatever `core-rs-albatross` triage requires (labels, milestone,
linked PRs). Update this file when the upstream issue is filed and again
when it's resolved.

---

## TL;DR for triage

`@nimiq/core` 2.4.0 (WebClient/WASM) panics in ~30% of testnet
handshakes inside `node:22-bookworm-slim` (Linux x86_64, glibc) with:

```
thread '<unnamed>' panicked at 'time not implemented on this platform':
/rustc/.../library/std/src/sys/time/unsupported.rs:35
```

Always shortly after `Requesting zkp from peer`. The standard library
hits the **`unsupported`** time backend at runtime — the symbol that
`/library/std/src/sys/time/unsupported.rs:35` exports is the panic
stub for targets that don't have a working `Instant`/`SystemTime`
implementation.

That's surprising because the binary is running under Node.js on
Linux x86_64 — where the standard time syscalls are obviously
available. The most likely diagnosis is that the `wasm32-unknown-unknown`
build path is in use (no JS shim mapping `Instant::now()` to
`performance.now()` / `Date.now()`), and **some** code path lands on
`Instant::now()` after the consensus handshake reaches a particular
state. The intermittency suggests it depends on the order of received
ZKP frames, network jitter, or a tokio scheduler decision.

This makes the WASM driver unfit for production today. Our project has
flipped the README + production-deployment docs to recommend
`FAUCET_SIGNER_DRIVER=rpc` until upstream resolves it.

---

## Why we think it's worth filing upstream rather than working around

- **Reproducible**: 3-of-10 boots panic on my workstation against
  testnet seed peers. Reproduces from a vanilla `docker compose up`.
- **Not our code path**: the panic site is inside the WASM blob from
  `@nimiq/core`. We don't call `Instant::now` from JS, and the panic
  PC is in the wasm function table, not in our wrapper.
- **Tied to consensus internals**: it always fires shortly after the
  ZKP-request handshake step. That's a consensus-layer code path, not
  something a downstream consumer can reroute.
- **Affects the documented Quick Start path**: `FAUCET_SIGNER_DRIVER=wasm`
  is the simplest mode for new contributors. Coin-flipping their first
  boot is a notable adoption blocker.

---

## What `core-rs-albatross` likely needs to look at

1. **Build target & feature flags** the WASM module is shipped with:
   `wasm32-unknown-unknown` vs `wasm32-wasip1`. The former requires
   JS-side time shims (e.g. `wasm-timer`, `web-time`, or a custom
   `Instant` import). The latter has time built into WASI.
2. **Audit Cargo deps for `instant` vs `tokio` time**. The
   `tokio-with-wasm` crate, the `gloo-timers` crate, and `web-time`
   are common alternatives; if any path falls through to `std::time`
   on the WASM target, that's the panic site.
3. **Random unwraps on time**. `Instant::now()` panics on an
   unsupported target before reaching any user code; if the panic
   message is `'time not implemented on this platform'` and not a
   user-defined `expect("…")`, the symbol is from `std`.
4. **Why intermittent?** Two plausible answers: (a) the panic-site
   code path runs only once consensus reaches a particular state and
   the order of incoming frames decides whether it runs early enough
   to be visible to us; (b) a worker/futures task fires at an
   unpredictable time and the panic is racy. Either way, *fixing the
   missing time impl* eliminates the question.

---

## Report body (copy this verbatim into the upstream issue)

> **Title**: WASM client panics intermittently with `'time not implemented on this platform'` shortly after testnet handshake (web-client / wasm32 build)
>
> ## Versions
>
> - `@nimiq/core` 2.4.0 (npm package — WASM web-client build).
> - Node.js 22.x on `node:22-bookworm-slim` (Debian Bookworm slim, Linux x86_64, glibc).
> - Network: TestAlbatross.
>
> ## What happens
>
> When the WASM client is initialised inside Node.js and asked to
> connect to TestAlbatross seed peers, ~30% of boots panic shortly
> after the `Requesting zkp from peer` log line:
>
> ```
> ERROR panic | thread '<unnamed>' panicked at 'time not implemented on this platform': /rustc/.../library/std/src/sys/time/unsupported.rs:35
>
> Error [RuntimeError]: unreachable
>     at wasm://wasm/01d5f8d2:wasm-function[2108]:0x25dd43
>     ...
> ```
>
> The Fastify HTTP server hosting the client is up and serving requests
> in the surviving 70% of boots, but the same panic can also fire mid-
> flight ~1 minute after a successful handshake.
>
> The panic message comes from the Rust standard library's `unsupported`
> time backend (`/library/std/src/sys/time/unsupported.rs:35`), which
> is the stub that gets linked when the build target has no
> implementation for `Instant::now()`/`SystemTime::now()`.
>
> ## Why this is surprising
>
> The binary is running on Linux x86_64 / glibc, where time syscalls
> are obviously available. The likely cause is that the WASM build
> target is `wasm32-unknown-unknown` (which falls through to the
> stdlib's `unsupported` time impl unless an explicit shim is wired
> in via JS imports / a wrapper crate like `web-time`). If that's
> right, this is a build-config issue inside `core-rs-albatross`'s
> `web-client` crate.
>
> ## Reproduction
>
> Standalone container repro (no third-party app needed):
>
> ```bash
> docker run --rm \
>   -e FAUCET_NETWORK=test \
>   -e FAUCET_SIGNER_DRIVER=wasm \
>   -e FAUCET_PRIVATE_KEY=$(openssl rand -hex 32) \
>   -e FAUCET_KEY_PASSPHRASE=at-least-eight-chars \
>   -e FAUCET_ADMIN_PASSWORD=at-least-eight-chars \
>   -e FAUCET_DEV=1 \
>   ghcr.io/panoramicrum/nimiq-simple-faucet:latest
> ```
>
> Run 10 times; ~3 fire the panic above. Affected boots crash the
> process; surviving boots may also crash mid-flight a minute later.
>
> Minimal Node-only repro (no faucet code in the path) requires only
> `npm install @nimiq/core@2.4.0 && node` followed by:
>
> ```js
> const nimiq = await import('@nimiq/core');
> const config = new nimiq.ClientConfiguration();
> config.network('TestAlbatross');
> config.seedNodes(['/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss']);
> const client = await nimiq.Client.create(config.build());
> await client.waitForConsensusEstablished();
> ```
>
> Loop this in a fresh container 10× to reproduce the coin-flip.
>
> ## What we'd like to know
>
> 1. Is `core-rs-albatross`'s WASM build target `wasm32-unknown-unknown`
>    (and therefore reliant on a JS time shim) or `wasm32-wasip1`?
> 2. If it's `wasm32-unknown-unknown`, where does the JS shim live
>    (or where does it fail to live)?
> 3. Is there a known-good `@nimiq/core` version we could pin until
>    a fix lands? `2.4.0` is what npm resolves \`^2.4.0\` to today.
>
> ## What we've ruled out
>
> - Container image quirks: reproduces on three different host kernels
>   (Linux 6.8, 6.6, macOS Docker Desktop with the linux/amd64 image).
> - Wallet key material: the panic happens before any signing call.
> - User code calling into time: the panic stack ends in the WASM
>   blob; our wrapper only \`await\`s \`Client.create\` and
>   \`waitForConsensusEstablished\`.
>
> ## Found while
>
> Building [`PanoramicRum/nimiq-simple-faucet`](https://github.com/PanoramicRum/nimiq-simple-faucet)'s
> Mini App example ([PR #113](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/113));
> tracked downstream as [issue #119](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/119).

---

## Working with the maintainers

When you file the upstream issue:

1. **Start small**: drop the "What we've ruled out" + "What we'd like to know" sections first. If they ask for more, paste the rest.
2. **Avoid the word "broken"**: it's an honest bug report, not a complaint. The Albatross team is small and unpaid; lead with the repro.
3. **Offer to test fixes**: their build matrix doesn't always cover Node.js + the npm bundle path. We can run a candidate `@nimiq/core` build through our CI \`docker\` job (lines 96–135 of [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) which already exercises the panic path.

### Ongoing collaboration plan

- **Pin a candidate version**: once upstream proposes a fix or a known-good version, bump our root `package.json` `@nimiq/core` pin and watch the CI smoke job for 10 consecutive runs to confirm the panic rate drops.
- **Mirror their reproducer**: if upstream creates a minimal Rust-side reproducer, link it from #119 and adjust our test plan accordingly.
- **Close the loop**: when upstream ships a fix, bump our pin, re-flip the docs to recommend WASM again (or keep RPC as recommended for production but stop calling WASM "smoke-test only"), and close #119.

## Tracking

- This repo: [issue #119](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/119) — keep open until upstream is resolved.
- Upstream: _to be filled in once filed against `nimiq/core-rs-albatross`._
- Workaround in CI: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) downgrades the panic to a `::warning::` instead of failing the build.
