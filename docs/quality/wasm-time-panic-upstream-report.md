# Upstream report: `@nimiq/core` WASM panics with `'time not implemented on this platform'`

**Status (2026-04-30)**: upstream fix [nimiq/core-rs-albatross#3729](https://github.com/nimiq/core-rs-albatross/pull/3729) (`OffsetTime: use instant::SystemTime to avoid wasm32 panic`) **MERGED 2026-04-28** at commit `9789c532148994352a70e5f5231e44d2c348913c`. We ran a 10× × 120s smoke matrix locally against `@nimiq/core@2.2.2` (last-known-good baseline) and `pkg.pr.new/@nimiq/core@3729` (candidate fix) — both cleared 0/10 panics versus ~3/10 on the broken `2.4.0` (results in §"Smoke matrix results (2026-04-30)" below). Workaround for downstream consumers until npm ships the post-fix release: pin `@nimiq/core` to `2.2.2`. The post-fix npm release is not yet published — `latest` is still `2.4.0` (gitHead `e156ecc4...`); we'll bump our pin and revert the docs once that lands.

**This repo**: tracked as [issue #119](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/119); replies sent to the maintainer are saved in [`wasm-time-panic-maintainer-reply-2026-04-27.md`](./wasm-time-panic-maintainer-reply-2026-04-27.md) and [`wasm-time-panic-maintainer-reply-2026-04-30.md`](./wasm-time-panic-maintainer-reply-2026-04-30.md).

**Upstream**: [`nimiq/core-rs-albatross`](https://github.com/nimiq/core-rs-albatross) (the `@nimiq/core` WASM client is built from this repo's web-client crate). Discussion happened in a chat with a `core-rs-albatross` maintainer; we did not need to file a public issue because the maintainer triaged it directly.

## Follow-up TODO (revisit in the near future)

- [x] **Check whether [PR #3729](https://github.com/nimiq/core-rs-albatross/pull/3729) has merged.** Merged 2026-04-28 at commit `9789c532148994352a70e5f5231e44d2c348913c`.
- [x] **Run the smoke job 10×** against:
  - [x] `@nimiq/core@2.2.2` (baseline) — 0/10 panics (10/10 healthz_ok). 2026-04-30.
  - [x] `pkg.pr.new/@nimiq/core@3729` (candidate fix) — 0/10 panics (10/10 healthz_ok). 2026-04-30.
  - [ ] First post-fix `@nimiq/core` release on npm, once published — should be 0/10.
- [ ] **Bump our pin** from `^2.4.0` → first post-fix release in [`package.json`](../../package.json) and [`packages/driver-nimiq-wasm/package.json`](../../packages/driver-nimiq-wasm/package.json). Blocked on npm release (`latest` is still `2.4.0`, gitHead `e156ecc4...` — pre-fix).
- [ ] **Flip the docs back**: revert the README + `docs/deployment-production.md` notes that recommend `FAUCET_SIGNER_DRIVER=rpc`, and remove the WASM smoke-test-only callout. Blocked on the bump.
- [ ] **Re-arm CI**: drop the panic-string filter in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) so the smoke job hard-fails on the panic again — once we trust WASM, it should be a real regression signal. Blocked on the bump.
- [ ] **Close [issue #119](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/119)** with a link to the upstream PR and the version we bumped to. Blocked on the bump.

This file remains the source-of-truth for the report. Update it when PR #3729 merges and again when this project bumps to the post-fix release.

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

## On-disk confirmation (2026-04-27)

After the maintainer confirmed they're investigating, we audited the
actual `@nimiq/core` 2.4.0 bundle on disk. Time-shim symbol counts
(`__wbg_now_*`, `Date.now`, `performance.now`) per bundle:

| Bundle                               | Time shims | Size   |
|--------------------------------------|-----------:|-------:|
| `nodejs/main-wasm/index.js`          |          0 | 992 KB |
| `nodejs/worker-wasm/index.js`        |          5 | 7.4 MB |
| `web/main-wasm/index.js`             |          0 |        |
| `web/worker-wasm/index.js`           |          1 |        |

Both bundles are `wasm32-unknown-unknown` (otherwise no JS time shims
would be needed). `worker-wasm` (the consensus/networking blob) has
`web-time`-style shims wired via wasm-bindgen externs; `main-wasm`
has none in either the Node or Web build.

Any code path reaching `std::time::Instant::now()` /
`SystemTime::now()` **directly** — i.e. not through a
`web-time`-style wrapper — will link the stdlib's `unsupported` time
backend on `wasm32-unknown-unknown` and panic with the exact message
we observe. The intermittency is consistent with a callsite that
only runs after a particular post-ZKP-handshake state is reached.

**Suggested remediation patterns** (for upstream to validate):

1. Replace `use std::time::{Instant, SystemTime}` with
   `use web_time::{Instant, SystemTime}` across the workspace (or
   add a `cargo patch` redirecting `instant` → `web-time`).
2. For deps not owned by the workspace, add a
   `[target.'cfg(target_arch = "wasm32")'.dependencies]` override.

A grep for `std::time::Instant::now\|SystemTime::now` across
`core-rs-albatross` + transitive deps that isn't already gated
behind `cfg(not(target_arch = "wasm32"))` should turn up the
offending callsite(s).

---

## Smoke matrix results (2026-04-30)

After PR #3729 merged we ran a 10× × 120s smoke matrix locally to (a) give
the maintainer independent confirmation that 2.2.2 is panic-free under
the same harness that hits ~30% on 2.4.0, and (b) get a first signal on
the candidate fix bundle from `pkg.pr.new`.

**Harness**: `deploy/docker/Dockerfile` built per pin, then booted with
the same env vars CI's `docker` smoke job uses. Modified vs CI: each
container is held alive 120 s past `/healthz` so the post-handshake
panic window is actually exercised — the original CI shape exits early
on the surviving 70%, racing healthz against the panic. Per-boot we
record healthz reachability and scan the container log for the panic
string `time not implemented on this platform`.

**Environment**: Linux Mint 22.3 (kernel 6.8.0-110), x86_64, 8 CPU,
33 GB RAM, Docker 29.1.3. Pin swapped per worktree (`/tmp/faucet-smoke-2.2.2`
and `/tmp/faucet-smoke-3729`) to avoid touching the working tree.

| Pin                                          | healthz_ok | panic | Bundle SHA-256 (`nodejs/worker-wasm/index_bg.wasm`) |
|----------------------------------------------|-----------:|------:|-----------------------------------------------------|
| `@nimiq/core@2.4.0` (npm, broken — historical) | n/a (~7/10) | ~3/10 | `b59394305f2adf78276a0b21ac6d424b4e61ad71eb629559d1a8aae88e7ac5f3` |
| `@nimiq/core@2.2.2` (npm, last-known-good)   | 10/10 | 0/10 | `baee5f7dc4b85610e467339fe5e428fbdec3623a0b648a2eabf046376a9862b7` |
| `pkg.pr.new/@nimiq/core@3729` (candidate fix) | 10/10 | 0/10 | `b2d186ff9f982d1d26d611830754cd59808d4f170ab1f8c4313c6dc5d271712b` |

All three bundles are distinct on disk, so we're testing what we think
we're testing. Both the baseline and the candidate cleared the matrix
with no panics, reaching `Consensus established` and surviving past
`Requesting zkp from peer` in every boot.

Once the post-fix npm release ships, we'll add a third row for it
(also expected 0/10) and proceed with the bump → docs revert →
CI panic-filter removal → close #119 sequence above.
