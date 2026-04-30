# Replies to `core-rs-albatross` maintainer — 2026-04-27

**Context**: WASM `'time not implemented on this platform'` panic in `@nimiq/core` 2.4.0. Maintainer confirmed the regression, then identified the fix in [nimiq/core-rs-albatross#3729](https://github.com/nimiq/core-rs-albatross/pull/3729) (`OffsetTime: use instant::SystemTime to avoid wasm32 panic`).

Related: [issue #119](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/119), [upstream report](./wasm-time-panic-upstream-report.md).

---

## Reply 1 — bisect coordinates (sent after the maintainer reproduced on 2.4.0 and identified it as a regression)

That narrows it nicely. Two things that may help further:

**There's a 2.3.0 gap on npm.** The version chain on npm is `2.2.0 → 2.2.1 → 2.2.2 → 2.4.0` — no `2.3.0` was ever published. So the actual last-known-good is `2.2.2`, not `2.2.0`. Worth re-confirming `2.2.2` is clean before you go too deep.

**Cross-referencing `gitHead` from each npm publish to your tags**:

| npm       | upstream tag | sha          | published   |
|-----------|--------------|--------------|-------------|
| `2.2.2`   | `v1.2.2`     | `119adae2f3` | 2026-02-27  |
| _(none)_  | `v1.3.0`     | `5bd15d9af7` | 2026-03-27  |
| `2.4.0`   | `v1.4.0`     | `e156ecc4a1` | 2026-04-22  |

Bisect window is **`v1.2.2..v1.4.0`** — 68 commits / 128 files. `v1.3.0` is a natural midpoint (`v1.2.2..v1.3.0` = 28 commits, `v1.3.0..v1.4.0` = 40), so a single WASM build at `v1.3.0` halves the search.

Three concrete asks if any are useful to you:

1. We can pin our project to `2.2.2` and run our smoke job 10× to confirm `2.2.2` is panic-free in the same environment that hits ~30% on `2.4.0` — independent confirmation of your repro.
2. If you can publish (or hand us a tarball of) a WASM build from `v1.3.0`, we'll run it through the same job and tell you which side panics — that splits the bisect in half in one round.
3. Same offer for any candidate fix.

---

## Reply 2 — acknowledging PR #3729 + commit to test the candidate

Thank you — clean fix, and the analysis lines up perfectly with what we'd seen from the on-disk bundle. `nodejs/main-wasm/index.js` ships zero `__wbg_now_*` / `Date.now` / `performance.now` shims (vs. 5 in `worker-wasm`), so any `std::time::SystemTime::now()` callsite reached from main-wasm code paths panics on `wasm32-unknown-unknown`. Drift validation being added to the light-blockchain sync path explains the "always shortly after `Requesting zkp from peer`" pattern in the panic logs cleanly.

We'll do two runs and report back:

1. **`@nimiq/core@2.2.2` baseline** — pin our project to `2.2.2` and run our smoke job 10× to give you independent confirmation it's panic-free under the same environment that hits ~30% on `2.4.0`.
2. **`pkg.pr.new/@nimiq/core@3729` candidate** — same job, 10×. If the panic rate drops to 0/10, that's a strong signal for merge. Happy to extend to 50 or 100 boots if a higher-confidence number would help.

Will post results in this thread (or directly on PR #3729, whichever you prefer).

In the meantime we'll flip our public docs to recommend `2.2.2` as the workaround instead of "use the RPC driver", with a pointer to PR #3729 for the proper fix.
