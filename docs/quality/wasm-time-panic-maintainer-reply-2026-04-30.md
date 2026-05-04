# Reply to `core-rs-albatross` maintainer — 2026-04-30

**Context**: WASM `'time not implemented on this platform'` panic in `@nimiq/core` 2.4.0. Maintainer's fix [PR #3729](https://github.com/nimiq/core-rs-albatross/pull/3729) (`OffsetTime: use instant::SystemTime to avoid wasm32 panic`) merged 2026-04-28 (commit `9789c532148994352a70e5f5231e44d2c348913c`). This file records the smoke-matrix results we promised in the [2026-04-27 reply](./wasm-time-panic-maintainer-reply-2026-04-27.md) (Reply 2).

Related: [issue #119](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/119), [upstream report](./wasm-time-panic-upstream-report.md).

---

## Reply 3 — smoke-matrix results (PR #3729 merged → testing baseline + candidate)

Thanks again for the quick turnaround on PR #3729. The fix merged on 2026-04-28; we ran the matrix we'd promised in the previous reply against the same Docker smoke harness CI uses (deploy/docker/Dockerfile + .github/workflows/ci.yml's smoke job, modified to keep each container alive 120s past `/healthz` so the post-handshake panic window is actually exercised — the original CI shape was racing healthz against the panic and exiting early on the surviving 70%).

**Environment**: Linux Mint 22.3 (kernel 6.8.0-110-generic), x86_64, 8-core, 33 GB RAM. Docker 29.1.3. node:22-bookworm-slim base. Image built from `deploy/docker/Dockerfile` with the `@nimiq/core` pin swapped per matrix row. Each boot ran `FAUCET_SIGNER_DRIVER=wasm` against TestAlbatross seed1, 120s exposure window, fresh container per run.

### Results

| Pin                                          | healthz_ok | panic | Notes |
|----------------------------------------------|-----------:|------:|-------|
| `@nimiq/core@2.2.2` (baseline)               | 10/10 | 0/10 | Every boot reached `Consensus established` and survived the full 120s exposure. |
| `pkg.pr.new/@nimiq/core@3729` (candidate)    | 10/10 | 0/10 | Same — clean across the same harness. |

For comparison: the original repro on `@nimiq/core@2.4.0` was ~3-of-10 boots (the "~30%" we'd reported). Both bundles tested above produced **zero** `'time not implemented on this platform'` panics across 10 boots × 120s exposure each — they reached `Consensus established`, the surviving 70% of the original 2.4.0 baseline made it past `Requesting zkp from peer`, and we held containers alive for ~90s past that point to catch any mid-flight panic. Independent confirmation that 2.2.2 is panic-free, and a 0/10 first signal for the candidate fix.

WASM bundle SHAs (sanity-check that pkg.pr.new actually shipped a new bundle, not a fall-through to npm 2.4.0):

| Pin                                       | `nodejs/worker-wasm/index_bg.wasm` SHA-256 |
|-------------------------------------------|--------------------------------------------|
| `@nimiq/core@2.4.0` (npm, broken)         | `b59394305f2adf78276a0b21ac6d424b4e61ad71eb629559d1a8aae88e7ac5f3` |
| `@nimiq/core@2.2.2` (npm, last-known-good)| `baee5f7dc4b85610e467339fe5e428fbdec3623a0b648a2eabf046376a9862b7` |
| `pkg.pr.new/@nimiq/core@3729` (candidate) | `b2d186ff9f982d1d26d611830754cd59808d4f170ab1f8c4313c6dc5d271712b` |

All three are distinct, so we're testing what we think we're testing.

### Next steps on our side

Once a post-fix `@nimiq/core` release lands on npm (currently `latest = 2.4.0`, gitHead `e156ecc4...`, pre-fix), we'll:

1. Bump `^2.4.0` → the post-fix release in [`package.json`](../../package.json) and [`packages/driver-nimiq-wasm/package.json`](../../packages/driver-nimiq-wasm/package.json).
2. Drop the panic-string filter we added to our CI smoke job (lines 122-136 of [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) so any future occurrence is a hard CI failure again.
3. Revert our README + production-deployment "use `FAUCET_SIGNER_DRIVER=rpc` for production" callouts back to recommending WASM as the default.
4. Close [issue #119](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/119) with a link to the bump PR.

Happy to extend the matrix to 50 or 100 boots per pin if a higher-confidence number would help — or to test additional candidate builds. Just say the word.
