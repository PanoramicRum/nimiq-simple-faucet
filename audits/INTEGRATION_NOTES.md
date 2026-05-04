# Integration notes — Mini App ↔ Nimiq Simple Faucet

A live report kept while building `examples/mini-app-claim-vue/` and `examples/mini-app-claim-react/` in [`PanoramicRum/nimiq-simple-faucet`](https://github.com/PanoramicRum/nimiq-simple-faucet) (branch `mini-app-claim-examples`). Each entry is something a future integrator would want to know, or an issue worth filing on the relevant upstream.

This doubles as the "test of the repo" you asked me to do — the friction below is what someone will hit if they try to ship a Mini App against this faucet today.

Legend:
- 🟢 **Worked first try** — copy/paste, no friction.
- 🟡 **Worked after a workaround** — record what and why.
- 🔴 **Real bug / blocker / docs gap** — should be filed as an issue.

---

## Working stack confirmed (smoke + runtime checks)

Both per-example compose stacks come up clean:

| Surface | URL the phone uses | Result |
|---|---|---|
| Vue mini app (Vite dev) | `http://<LAN_IP>:5173/` | HTTP 200, full SPA shell |
| React mini app (Vite dev) | `http://<LAN_IP>:5174/` | HTTP 200, full SPA shell |
| Faucet `/healthz` | `http://<LAN_IP>:28080/healthz` (Vue stack) | HTTP 200 |
| Faucet `/v1/config` | same | returns `captcha: { provider: 'fcaptcha', siteKey, serverUrl }` |
| fcaptcha widget bundle | `http://<LAN_IP>:3010/fcaptcha.js` | HTTP 200, 98 KB |
| fcaptcha PoW challenge | `http://<LAN_IP>:3010/api/challenge` | issues challenge JSON |

Both `pnpm turbo run build` chains in Docker succeed: Vue produces 72 KB / 28 KB gz, React 153 KB / 50 KB gz.

End-to-end claim flow validation against a real Nimiq Pay WebView is the manual gate (`mini-apps-checklist` skill). Cannot be automated in CI — that's a doc-of-record limit, not something I can close.

---

## Findings

### 🟢 SDK shapes are consistent across frameworks

`@nimiq-faucet/sdk`, `/vue`, `/react` all delegate to `ClaimManager`, `StatusPoller`, `StreamManager` from the framework-agnostic core. A future Svelte/vanilla example reuses them with no SDK fork. No drift between Vue and React `useFaucetClaim` shapes.

### 🟢 `FaucetConfig.captcha` discriminator is well-typed for fcaptcha

```ts
captcha: {
  provider: 'turnstile' | 'hcaptcha' | 'fcaptcha';
  siteKey: string;
  serverUrl?: string;  // present only when provider is 'fcaptcha'
} | null;
```

`/v1/config` returns this exactly as documented — the mini app picks the right widget purely from the response. (Caveat: `serverUrl` is a single value; it must be reachable from BOTH the faucet container AND the browser. See finding 🟡 below.)

### 🟡 `@nimiq/mini-app-sdk@0.0.2` — error returns aren't a clean discriminated union

From the published SDK's `dist/provider.d.ts`:

```ts
listAccounts(): Promise<string[] | ErrorResponse>;
sign(message: ...): Promise<SignatureResult | ErrorResponse>;
sendBasicTransaction(tx: ...): Promise<string | ErrorResponse>;
```

`ErrorResponse` is `{ error: { type: string; message: string } }`. Every call site has to write a runtime guard:

```ts
const result = await provider.listAccounts();
if ('error' in result) throw new Error(result.error.message);
const addresses = result; // typed as string[]
```

Either thrown errors or a `{ ok: true; value } | { ok: false; error }` union would let TS narrow naturally. Our shared bridge wraps this once so consumers don't repeat it.

→ **Issue (developer-center)**: standardise on a single error convention across all `NimiqProvider` methods and document it on the SDK reference page.

### 🟡 `@nimiq/mini-app-sdk` is at `0.0.2` and unversioned in the scaffold skill

The best-practices and scaffold skills in [`nimiq/developer-center#175`](https://github.com/nimiq/developer-center/pull/175) say `npm install @nimiq/mini-app-sdk` with no range. `0.0.x` versions imply more breaking changes ahead.

→ **Issue (developer-center)**: pin a `^0.0.2` (or whatever's tested) in the scaffold skill, document upgrade story in build-with-AI.

### 🔴 The published SDK and the official demo disagree on package name

- `nimiq/developer-center#175` best-practices skill: `@nimiq/mini-app-sdk`.
- [`Eligioo/nimiq-mini-app-demo`](https://github.com/Eligioo/nimiq-mini-app-demo) (linked from best-practices as a reference impl): `@trustwallet/web3-provider-nimiq` from a relative file path.

They're related (the published SDK wraps the trust-web3-provider package), but a brand-new contributor following the demo will install a different package than the docs prescribe.

→ **Issue (developer-center)**: update the demo to consume `@nimiq/mini-app-sdk` from npm, OR call out the relationship explicitly in the demo README.

### 🔴 No empirical test of WebView `Origin` header

I have not been able to test what Android WebView vs iOS WKWebView puts in the `Origin` header for fetches from a LAN-loaded mini app. If `null`, the faucet's browser-only enforcement (`FAUCET_REQUIRE_BROWSER=true`) blocks it, AND `FAUCET_CORS_ORIGINS` matching needs explicit `null`-origin handling.

The example compose sets `FAUCET_CORS_ORIGINS=*` and `FAUCET_REQUIRE_BROWSER=false` so this is a non-issue for LAN dev — but production deployments need a real answer.

→ **Issue (faucet)**: real-phone test that records the `Origin` header from inside Nimiq Pay's WebView on Android + iOS. Document in `apps/docs/`.
→ **Issue (developer-center)**: add a "fetching backends from a Mini App" section to `mini-apps-best-practices` covering CORS + the `Origin` question.

### 🔴 Repo-root `.dockerignore` excludes `examples/` and most framework SDKs

```
# faucet/.dockerignore
examples
packages/sdk-vue
packages/sdk-react
packages/sdk-flutter
packages/sdk-go
packages/sdk-react-native
packages/sdk-capacitor
deploy/compose
```

Plain `docker build -f examples/<any>/Dockerfile -t x .` from the repo root fails because the build context is missing the example AND most of the SDK packages. The existing `examples/vue-claim-page/Dockerfile` and `examples/nextjs-claim-page/Dockerfile` are subject to the same — they likely never run via plain `docker build`, only via the existing `examples/docker-compose.yml` pipeline (and even that is suspect; see the next finding).

**Workaround**: each new example ships a sibling `Dockerfile.dockerignore` (and `Dockerfile.dev.dockerignore`) that BuildKit honors instead of the root one.

→ **Issue (faucet)**: either move the per-image excludes into per-Dockerfile dockerignores everywhere, or provide a `.dockerignore` per build context. Today's setup quietly breaks any plain `docker build` of an example.

### 🔴 Existing per-example Dockerfiles assume a deps-only-cache layer that can't actually install

Both `examples/vue-claim-page/Dockerfile` and `examples/nextjs-claim-page/Dockerfile` follow a "copy package.jsons → pnpm install → copy source" pattern. They `COPY` only `pnpm-workspace.yaml`, the root `package.json`, the lockfile, and a few example-specific `package.json` files.

But the root `package.json` has:

```json
"devDependencies": {
  "@faucet/abuse-hashcash": "workspace:*"
}
```

…and `pnpm install` validates the lockfile against every workspace member. Without `packages/abuse-hashcash/package.json` in the build context, install fails with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. I hit this. The simplest correct pattern is to copy the full workspace once, then `pnpm install --filter @nimiq-faucet/example-...`.

→ **Issue (faucet)**: rewrite `examples/vue-claim-page/Dockerfile` and `examples/nextjs-claim-page/Dockerfile` to either (a) include all workspace `package.json` files, or (b) match the simpler "copy everything, filtered install" pattern used by the new mini-app examples. Add a CI job that actually runs `docker build` against each example to prevent regression.

### 🔴 `deploy/compose/fcaptcha.yml` references a non-existent public image

```yaml
fcaptcha:
  image: ghcr.io/webdecoy/fcaptcha:latest
```

`docker pull ghcr.io/webdecoy/fcaptcha:latest` returns `unauthorized`, and `docker pull webdecoy/fcaptcha:latest` returns `pull access denied`. The image isn't published anywhere public. Following the documented fcaptcha enable path silently breaks.

**Workaround**: our example ships [`examples/mini-app-claim-shared/fcaptcha/Dockerfile`](faucet/examples/mini-app-claim-shared/fcaptcha/Dockerfile) which clones [WebDecoy/FCaptcha](https://github.com/WebDecoy/FCaptcha) and builds the server-node container locally. Per-example compose overrides the `fcaptcha.image` and points to this build context.

→ **Issue (faucet)**: either publish a real `ghcr.io/panoramicrum/fcaptcha:<ref>` image (mirror or fork), or replace `image:` with a `build:` block in `deploy/compose/fcaptcha.yml` that builds from the upstream repo. The current value is broken-as-shipped.
→ **Issue (developer-center, indirectly)**: when a faucet example is added to the Mini Apps ideas page, link the fixed compose so people don't hit this.

### 🔴 FCaptcha's server-node does not serve `client/fcaptcha.js`

The widget bundle the browser needs lives at `client/fcaptcha.js` in the upstream repo, but the `server-node/server.js` express app only registers `/health`, `/api/verify`, `/api/score`, `/api/token/verify`, `/api/pow/challenge`, `/api/challenge`. Browsers fetching `<serverUrl>/fcaptcha.js` get 404.

The faucet's `FaucetConfig.captcha.serverUrl` returns the operator-provided fcaptcha URL — implying the operator's deployment is supposed to serve the widget. Upstream's published deploy story doesn't.

**Workaround (currently shipping)**: this repo's `deploy/compose/fcaptcha/Dockerfile` (PR [#137](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/137)) and the per-example `examples/mini-app-claim-shared/fcaptcha/Dockerfile` both `sed`-patch `server.js` to add `app.use('/fcaptcha.js', express.static('/app/client/fcaptcha.js'))`. Verified working: `curl http://<LAN_IP>:3010/fcaptcha.js` returns the 98 KB bundle.

→ **Issue (FCaptcha upstream)**: filed as [WebDecoy/FCaptcha#4](https://github.com/WebDecoy/FCaptcha/issues/4). Maintainer reaction status below.
→ **Issue (faucet)**: until upstream FCaptcha ships the fix in a tagged release, keep the `sed`-patched Dockerfile as the recommended path. Mention in `packages/abuse-fcaptcha/` README.

#### Upstream status (2026-04-27)

Maintainer [@cport1](https://github.com/cport1) confirmed the fix is welcome and asked for three small tweaks before we open the PR. Comment thread: [WebDecoy/FCaptcha#4 (comment)](https://github.com/WebDecoy/FCaptcha/issues/4#issuecomment-4330147804).

- **`server-go` already serves `/fcaptcha.js`** (via `main.go:63` + Docker `COPY client/fcaptcha.js ./static/`). The actual gap is `server-node` + `server-python` only.
- **Use `res.sendFile` instead of `express.static`** — single-file route is cleaner than the directory-binding shape:
  ```js
  app.get('/fcaptcha.js', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'fcaptcha.js'));
  });
  ```
- **Add `FCAPTCHA_CLIENT_PATH` env override** — the `../client` assumption breaks if anyone copies `server-node/` standalone.
- **Confirmed**: opt-out default + the `FCAPTCHA_SERVE_CLIENT` env name are both fine. Open the PR. `server-python` parity is fine as a follow-up.

PR opened upstream as **[WebDecoy/FCaptcha#5](https://github.com/WebDecoy/FCaptcha/pull/5)** (2026-04-28; 2 files, +29/-0). Already used `res.sendFile` from the original draft, then amended on the fork to add the `FCAPTCHA_CLIENT_PATH` override and correct the INSTALLATION.md `server-go` parity note.

#### Follow-up TODO

- [x] ~~Amend the draft branch per the three asks above.~~ Done — commit `9a3514f` on `PanoramicRum/FCaptcha:serve-client-bundle`.
- [x] ~~Open PR upstream against [WebDecoy/FCaptcha](https://github.com/WebDecoy/FCaptcha).~~ Done — [PR #5](https://github.com/WebDecoy/FCaptcha/pull/5).
- [ ] **Watch [PR #5](https://github.com/WebDecoy/FCaptcha/pull/5) (server-node) for review feedback** and amend if @cport1 asks for changes.
- [x] ~~`server-python` parity as a separate follow-up PR.~~ Done — [PR #6](https://github.com/WebDecoy/FCaptcha/pull/6) (`PanoramicRum/FCaptcha:serve-client-bundle-python`, FastAPI `FileResponse` route + same `FCAPTCHA_SERVE_CLIENT` / `FCAPTCHA_CLIENT_PATH` env vars).
- [ ] **Watch [PR #6](https://github.com/WebDecoy/FCaptcha/pull/6) (server-python) for review feedback** and amend if @cport1 asks for changes.
- [ ] **Once merged + tagged**: bump the `RELEASE_TAG`/`git checkout` reference in [`deploy/compose/fcaptcha/Dockerfile`](../deploy/compose/fcaptcha/Dockerfile) and [`examples/mini-app-claim-shared/fcaptcha/Dockerfile`](../examples/mini-app-claim-shared/fcaptcha/Dockerfile), then drop the `sed` patch (the route now ships in upstream `server.js`).
- [ ] **Update `packages/abuse-fcaptcha/` README** to point at the upstream tag instead of the workaround once the patch ships.

### 🔴 `FAUCET_FCAPTCHA_URL` conflates server-side and browser-side URLs

The same env var is used for two purposes:
1. **Server-to-server**: faucet → fcaptcha to verify a token (`POST /api/verify`). Best value: internal Docker DNS (`http://fcaptcha:3000`).
2. **Browser-facing**: returned in `/v1/config.captcha.serverUrl`. Best value: a URL the browser can actually reach (e.g. `http://<LAN_IP>:3010` for LAN dev, `https://captcha.example.com` for prod).

Setting it to `http://fcaptcha:3000` works for the faucet but the phone WebView can't resolve `fcaptcha`. Setting it to the LAN IP works for the phone, and it ALSO works for the faucet container because Docker's bridge allows outbound. So in dev, the LAN IP is the only value that satisfies both.

In production, this is fine because the public URL is reachable from both sides. In dev, it's a footgun.

→ **Issue (faucet)**: split into `FAUCET_FCAPTCHA_INTERNAL_URL` (server-to-server, defaults to public URL) and `FAUCET_FCAPTCHA_PUBLIC_URL` (returned to browser). Or just document the dev quirk loudly in `packages/abuse-fcaptcha/`.

### 🔴 `@nimiq/core` WASM panics intermittently on startup with `time not implemented on this platform`

When booting `nimiq-faucet:dev` (built from `deploy/docker/Dockerfile`) with `FAUCET_SIGNER_DRIVER=wasm`, ~30% of starts crash with:

```
ERROR panic | thread '<unnamed>' panicked at 'time not implemented on this platform':
/rustc/.../library/std/src/sys/time/unsupported.rs:35
```

…shortly after the `Requesting zkp from peer` log line. The Fastify HTTP server is up and responsive in the surviving 70%; one minute later it can also crash mid-flight. This is independent of fcaptcha or our env.

The image is `node:22-bookworm-slim` — Linux x86_64, glibc — should not be missing any common time syscalls. Likely an interaction between `@nimiq/core` 2.4.0 WASM and the network conditions during testnet handshake.

**Workaround for our PR**: the README documents the option to switch to `FAUCET_SIGNER_DRIVER=rpc` + the `local-node` profile. Smoke-build + per-service health checks are the gate; full claim flow needs a real phone anyway.

→ **Issue (faucet / @nimiq/core)**: investigate the WASM time-syscall panic. May be a known issue worth pinning a different `@nimiq/core` version or a sysconf override. Worth adding a CI smoke-up of the WASM driver since this is the default in `quick start`.

### 🟡 `pnpm install` in Docker — workspace filter trims correctly

`pnpm install --filter @nimiq-faucet/example-mini-app-vue... --frozen-lockfile=false` installs only the example + its workspace deps (sdk-ts, sdk-vue, mini-app-claim-shared) rather than the full graph. Cuts the image size meaningfully (no Nimiq-WASM blob, no Postgres client, no playwright browsers).

### 🟡 Vite HMR over Docker requires `VITE_HMR_HOST`

Without it, the HMR client tries `localhost:5173` from inside the phone WebView and silently fails. Setting `VITE_HMR_HOST=<LAN_IP>` in the dev compose fixes it. Worth a one-liner in `mini-apps-scaffold`.

→ **Issue (developer-center)**: add to scaffold skill — when generating a Vite-based Mini App, set `VITE_HMR_HOST` from env or document the manual config.

### 🟡 Per-example Compose port mappings collide on common ports

Default `8080` (faucet), `3000` (fcaptcha) — almost everyone running this on a dev machine has SOMETHING bound to those. Our compose uses `${FAUCET_HOST_PORT:-28080}` etc. with `ports: !override` to remap host-side without touching the included compose fragment.

→ **Issue (faucet)**: in `deploy/compose/docker-compose.yml`, default to `${FAUCET_HOST_PORT:-8080}` / `${FCAPTCHA_HOST_PORT:-3000}` instead of hardcoded ports. Lets contributors run multiple stacks side-by-side without forking.

### 🟢 Faucet `/v1/config` exposes everything a Mini App needs

Network, claim amount, abuse layers, captcha config (with `serverUrl` for fcaptcha) — one call gives the mini app everything it needs to render the right widget and set expectations. Good shape.

---

## Decisions baked into this PR (recap)

- **Self-contained per-example compose**: `include:` pulls `deploy/compose/docker-compose.yml` + `deploy/compose/fcaptcha.yml`, then overrides what's broken (image, ports, env). One command per example, zero duplication.
- **fcaptcha as the demo captcha** (your pick): self-hosted, no third-party iframe. WebView-friendly. Required upstream patches noted above.
- **Shared module local, not a published package**: graduates to `packages/mini-app-core/` → `@nimiq-faucet/mini-app` once a third framework example exists.
- **Mini App SDK return type narrowed** in `bridge.ts:getUserAddress` so call sites never see `ErrorResponse`.
- **Testnet only**: examples never default to mainnet. README explicitly calls this out plus the `FAUCET_TLS_REQUIRED=false` / `FAUCET_CORS_ORIGINS=*` dev-only warning.

## What was validated

- ✅ `pnpm turbo run build --filter @nimiq-faucet/example-mini-app-vue` (inside Docker) → 72 KB JS / 28 KB gz, 0 errors.
- ✅ `pnpm turbo run build --filter @nimiq-faucet/example-mini-app-react` (inside Docker) → 153 KB JS / 50 KB gz, 0 errors.
- ✅ `docker compose up -d` (Vue stack) → faucet, fcaptcha, vite all start, all health endpoints return HTTP 200.
- ✅ `/v1/config` returns the right `fcaptcha` provider block with a LAN-reachable `serverUrl`.
- ✅ `/fcaptcha.js` serves the 98 KB widget bundle from the LAN URL.
- ✅ `/api/challenge` issues PoW challenges from the LAN URL.
- ❓ Full claim against real Nimiq Pay WebView — manual phone test, can't be CI'd.
- ❓ WASM consensus stability — intermittent panic upstream, see finding above.

## Issues to file

Counting per upstream:

**Against `PanoramicRum/nimiq-simple-faucet`** (8):
1. `.dockerignore` breaks plain `docker build` of any example.
2. `examples/{vue-claim-page,nextjs-claim-page}/Dockerfile` deps-only-cache pattern is broken; rewrite or test in CI.
3. `deploy/compose/fcaptcha.yml` image (`ghcr.io/webdecoy/fcaptcha:latest`) doesn't exist publicly.
4. `FAUCET_FCAPTCHA_URL` conflates server-side and browser-side URLs.
5. `@nimiq/core` WASM `time not implemented` panic; investigate and pin.
6. Hardcoded host ports in `deploy/compose/docker-compose.yml` collide; allow env overrides.
7. Document WebView `Origin` header behaviour (Android + iOS) once empirically tested.
8. Add CORS-wildcard subdomain support to `FAUCET_CORS_ORIGINS` for staging Mini App deploys.

**Against `nimiq/developer-center`** (7):
9. Add "Faucet" to the Mini Apps ideas page; link this PR once merged.
10. Add `/mini-apps/sdk-reference` documenting the `@nimiq/mini-app-sdk` API.
11. Standardise NimiqProvider error returns across all wallet methods (`listAccounts`, `sign`, `sendBasicTransaction`, etc.).
12. Pin a tested `@nimiq/mini-app-sdk` version in `mini-apps-scaffold` skill.
13. Reconcile `Eligioo/nimiq-mini-app-demo` with the published `@nimiq/mini-app-sdk` package name.
14. Add CORS / backend-API section to `mini-apps-best-practices` skill.
15. Add `VITE_HMR_HOST` guidance to `mini-apps-scaffold` skill.

**Against `WebDecoy/FCaptcha`** (1):
16. server-node should serve `client/fcaptcha.js` by default, or its README should document that operators must.

I'll open these as draft issues against the maintainer's repo when the PR is filed (or include them in the PR description as a follow-up checklist if you'd prefer).
