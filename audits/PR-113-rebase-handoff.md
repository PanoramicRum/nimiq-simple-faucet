# PR #113 rebase hand-off — upstream fixes have landed

Hi! 👋 Thanks for the very thorough integration write-up in [`audits/INTEGRATION_NOTES.md`](./INTEGRATION_NOTES.md). All 7 of the issues you filed (#115–#122 minus the still-pending #119 and #121) now have upstream fixes on `main`. PR #113 should rebase cleanly with significantly fewer files — the workarounds you wrote can be dropped because the upstream paths now do the right thing.

This doc walks through:

1. Which upstream PRs landed and what each one closes.
2. Which workaround files in your branch become redundant.
3. The exact rebase steps.
4. The two issues that intentionally stayed open (and why) plus how to help close them.

---

## What landed upstream

All against `main`, between 2026-04-26 ~22:00 and ~02:00 UTC.

| Upstream PR | Issues closed | Summary |
|---|---|---|
| [#136](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/136) | #115, #116 | Root `.dockerignore` trimmed to universal excludes; server-image-only excludes moved to `deploy/docker/Dockerfile.dockerignore`. Both `examples/{vue,nextjs}-claim-page/Dockerfile` rewritten to "copy full workspace, filter install" — same pattern your mini-app Dockerfiles use. New CI `examples-build` job runs `docker buildx build` on each example so this can't regress. |
| [#137](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/137) | #117, #118 | New `deploy/compose/fcaptcha/Dockerfile` builds WebDecoy/FCaptcha v1.7.0 from source and `sed`-patches `server.js` to expose `/fcaptcha.js` — same shape as your `examples/mini-app-claim-shared/fcaptcha/Dockerfile`. The compose overlay now uses `build:` instead of the unpullable `image:`. Server config split into `FAUCET_FCAPTCHA_INTERNAL_URL` (server-to-server) + `FAUCET_FCAPTCHA_PUBLIC_URL` (browser-facing); legacy `FAUCET_FCAPTCHA_URL` honoured for one minor with a deprecation warning. |
| [#138](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/138) | #120 | `${FAUCET_HOST_PORT:-8080}` and `${NIMIQ_P2P_HOST_PORT:-8443}` in `deploy/compose/docker-compose.yml`. Tranche B already added `FCAPTCHA_HOST_PORT` to `fcaptcha.yml`. |
| [#139](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/139) | #122 | `FAUCET_CORS_ORIGINS` accepts `*.example.com` patterns. Both Fastify CORS and the browser-only `Origin` enforcement match the new shape. New `docs/mini-apps-integration.md` covers CORS + FCaptcha URL placement + the WebView `Origin` test plan. |
| [#140](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/140) | tracks #119 | README + production docs flipped to recommend `FAUCET_SIGNER_DRIVER=rpc` for production (your call in the example READMEs is now the project-wide recommendation). CI smoke distinguishes the upstream WASM panic from real regressions and downgrades it to a `::warning::` instead of failing the build. New `docs/quality/wasm-time-panic-upstream-report.md` is a maintainer-ready draft we'll file against `nimiq/core-rs-albatross`. |

Server test count went from 115 → 123 across these PRs (+5 fcaptcha-url-split, +8 cors-wildcard). All CI green per PR.

---

## Workarounds in PR #113 that can be dropped

Each of these files landed in your branch as a local workaround for an upstream gap. With the upstream fix in place, they're redundant — keeping them creates two sources of truth that drift.

### After rebasing onto `main`, delete:

| File in PR #113 | Replaced upstream by | Why |
|---|---|---|
| `examples/mini-app-claim-vue/Dockerfile.dockerignore` | (not needed) | Root `.dockerignore` no longer excludes `examples/`. |
| `examples/mini-app-claim-vue/Dockerfile.dev.dockerignore` | (not needed) | Same. |
| `examples/mini-app-claim-react/Dockerfile.dockerignore` | (not needed) | Same. |
| `examples/mini-app-claim-react/Dockerfile.dev.dockerignore` | (not needed) | Same. |
| `examples/mini-app-claim-shared/fcaptcha/Dockerfile` | [`deploy/compose/fcaptcha/Dockerfile`](../deploy/compose/fcaptcha/Dockerfile) | Identical pattern, pinned to v1.7.0. Reference the upstream one from your example compose files. |

### After rebasing, simplify:

#### `examples/mini-app-claim-{vue,react}/docker-compose.yml`

- **Drop the `ports: !override` block** under the included `faucet` and `fcaptcha` services. The upstream compose now reads `${FAUCET_HOST_PORT:-8080}` / `${FCAPTCHA_HOST_PORT:-3000}` directly, so you set those env vars (in the per-example `.env` or as `environment:` keys on the compose file) instead of an override block.
- **Remove the local fcaptcha build context** (the line that points at `examples/mini-app-claim-shared/fcaptcha/`). The included `deploy/compose/fcaptcha.yml` now ships its own working `build:` block.
- **Optionally swap `FAUCET_FCAPTCHA_URL` → `FAUCET_FCAPTCHA_PUBLIC_URL`**. Your existing `FAUCET_FCAPTCHA_URL=http://<LAN_IP>:3010` keeps working (deprecation warning at boot), but the cleaner shape is to set:
  - `FAUCET_FCAPTCHA_PUBLIC_URL=http://<LAN_IP>:3010` (the phone hits this)
  - leave `FAUCET_FCAPTCHA_INTERNAL_URL` unset (server uses `http://fcaptcha:3000` automatically when the overlay is included)

#### CORS

If your dev compose still sets `FAUCET_CORS_ORIGINS=*` but you'd like a slightly tighter allow-list, the new wildcard syntax accepts:

```env
# Single LAN IP
FAUCET_CORS_ORIGINS=http://192.168.1.50:5173,http://192.168.1.50:5174

# Or staging-deploy wildcards
FAUCET_CORS_ORIGINS=*.staging.example.com
```

This is purely optional; `*` is fine for LAN dev.

---

## Rebase steps

```bash
# In your local clone of the repo
git fetch origin
git checkout mini-app-claim-examples
git rebase origin/main
```

Conflicts will be on the workaround files only (they're effectively "removed" upstream because the new upstream paths obviate them). Resolve each by **deleting** the workaround file:

```bash
# Example: when git complains about Dockerfile.dockerignore
git rm examples/mini-app-claim-vue/Dockerfile.dockerignore
git rm examples/mini-app-claim-vue/Dockerfile.dev.dockerignore
git rm examples/mini-app-claim-react/Dockerfile.dockerignore
git rm examples/mini-app-claim-react/Dockerfile.dev.dockerignore
git rm examples/mini-app-claim-shared/fcaptcha/Dockerfile

# Then continue
git rebase --continue
```

If the per-example `docker-compose.yml` files conflict (because of port-override blocks or the local fcaptcha build path), follow the "After rebasing, simplify" notes above to resolve.

### Verify after rebase

```bash
# 1. Build both examples cleanly from a vanilla `docker build`
docker buildx build -f examples/mini-app-claim-vue/Dockerfile -t mini-vue:test .
docker buildx build -f examples/mini-app-claim-react/Dockerfile -t mini-react:test .

# 2. Boot each per-example stack
cd examples/mini-app-claim-vue
docker compose up -d --build
curl -fsS http://localhost:${FAUCET_HOST_PORT:-28080}/healthz   # → 200
curl -fsS http://localhost:${FCAPTCHA_HOST_PORT:-3010}/fcaptcha.js | head -c 80
docker compose down

# 3. Workspace builds + tests
pnpm install --frozen-lockfile
pnpm turbo run build --filter '@nimiq-faucet/example-mini-app-vue' --filter '@nimiq-faucet/example-mini-app-react'
```

If anything fails, ping back — the most likely cause is a stale `node_modules` from the pre-rebase state (`rm -rf node_modules apps/*/node_modules packages/*/node_modules examples/*/node_modules && pnpm install --frozen-lockfile` clears it).

---

## Two issues we deliberately kept open

### #119 — `@nimiq/core` WASM `'time not implemented on this platform'` panic

**Status**: tracking ticket open in this repo; ready to file upstream.

We have a maintainer-ready draft against `nimiq/core-rs-albatross` at [`docs/quality/wasm-time-panic-upstream-report.md`](../docs/quality/wasm-time-panic-upstream-report.md). It includes:

- **Diagnosis**: most likely the WASM build target is `wasm32-unknown-unknown` without a JS shim wiring `Instant::now()` to `performance.now()`/`Date.now()`, so the stdlib's `unsupported` time backend gets linked. Section "What `core-rs-albatross` likely needs to look at" walks through the build-target / feature-flag possibilities.
- **Standalone Docker repro**: 10 boots, ~3 panic. Single `docker run` command.
- **Node-only minimal repro**: `npm install @nimiq/core@2.4.0` + 8 lines of JS, no faucet code in the path.
- **"What we'd like to know"**: triage list to send to upstream — build target, JS shim location, known-good pin candidate.
- **Working-with-the-maintainers section**: tone notes, ongoing-collaboration plan, close-the-loop tracking.

**Action**: Ricardo (project maintainer) will file this against [`nimiq/core-rs-albatross`](https://github.com/nimiq/core-rs-albatross). Once filed, we update the doc's "Tracking" section with the upstream URL and link from #119. If you want to coordinate or be CC'd on the upstream thread, just say so.

CI is now tolerant of the panic: when our `docker` smoke job sees the exact `'time not implemented on this platform'` string in the logs, it emits a CI `::warning::` and exits 0 instead of failing. So #119 doesn't red-flag your PR's CI run anymore.

### #121 — WebView `Origin` header empirical test

**Status**: open, tagged for a real-phone test.

The test plan lives in [`docs/mini-apps-integration.md`](../docs/mini-apps-integration.md) under "Capturing the `Origin` value (for the phone test)". It's exact log-tail steps:

1. Boot the faucet with `FAUCET_DEV=1` (request logs unredacted).
2. Run a mini-app against it on a real phone inside Nimiq Pay → Mini Apps.
3. Tail the faucet logs while the phone fires `POST /v1/claim` and grab `req.headers.origin`.
4. Record the value for Android Chrome WebView, iOS WKWebView, and Nimiq Pay on each.
5. Comment on [#121](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/121) with the result.

This is the one piece that genuinely needed your hands on a phone — we can't CI it. If you've got bandwidth to run it during your next round of mini-app work, that closes the last open follow-up. If not, no rush; the doc currently recommends `FAUCET_REQUIRE_BROWSER=false` for Mini App callers, which is a safe-by-default until we know the answer.

---

## Anything else?

If the rebase hits something not covered above (compose include semantics, a workaround we missed, etc.) just ping back. Thanks again — the integration notes were genuinely the most useful contribution we've had this quarter.
