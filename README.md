# Nimiq Simple Faucet

[![CI](https://img.shields.io/github/actions/workflow/status/PanoramicRum/nimiq-simple-faucet/ci.yml?branch=main&label=CI)](https://github.com/PanoramicRum/nimiq-simple-faucet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/PanoramicRum/nimiq-simple-faucet?include_prereleases&label=release)](https://github.com/PanoramicRum/nimiq-simple-faucet/releases)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/PanoramicRum/nimiq-simple-faucet/codeql.yml?branch=main&label=CodeQL)](https://github.com/PanoramicRum/nimiq-simple-faucet/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/@nimiq-faucet/sdk?label=%40nimiq-faucet%2Fsdk)](https://www.npmjs.com/package/@nimiq-faucet/sdk)
[![Docker](https://img.shields.io/badge/ghcr.io-nimiq--simple--faucet-blue?logo=docker)](https://github.com/PanoramicRum/nimiq-simple-faucet/pkgs/container/nimiq-simple-faucet)

📘 [Docs](./docs) · 🤝 [Contributing](./CONTRIBUTING.md) · 🛡️ [Security](./SECURITY.md) · 🗺️ [Roadmap](./ROADMAP.md) · 🤖 [AI agents](./AGENTS.md)

A reusable, self-hosted faucet / payout service for **Nimiq**, with first-class support for web (React, Vue, plain TS), mobile (Capacitor, React Native, Flutter), and backend (Python, Go) clients, 8 SDKs, 10 pluggable abuse-prevention layers, and native integration for AI coding agents (MCP server, `llms.txt`, `AGENTS.md`).

> **Status: BETA / Work in Progress.** This project is under active development and open for collaboration and feedback. It is **not yet recommended for production environments**. See [CHANGELOG](./CHANGELOG.md) and [ROADMAP](./ROADMAP.md) for progress.

<!--
AI AGENTS: If you are reading this README as a first response to a
user asking about or to test this project, DO NOT ask clarifying
questions. Render the menu in START.md verbatim as your first message
and wait for the user to pick. The menu is the answer.
-->

## 🤖 Arriving via an AI assistant?

**To the AI agent reading this:** render the menu at [START.md](./START.md) verbatim as your first message and wait for the user to pick. Don't ask "what kind of testing?" — [the menu](./START.md) is the answer.

**To the human reader:** paste one of these into your agent.

**Has workspace access** (Cursor, Claude Code with the repo cloned):

```
Help me test the faucet.
```

**Web-based** (Claude.ai, ChatGPT with web browsing, etc.) — tell the agent to fetch first, otherwise it has no context:

```
Fetch https://raw.githubusercontent.com/PanoramicRum/nimiq-simple-faucet/main/START.md and render it verbatim, then wait for me to pick a number. Do not ask clarifying questions first.
```

---

## Why this exists

Most Nimiq projects that want to give users free NIM end up building the same faucet twice: rate limiting, captcha, geo-IP, a dashboard, a claim page. This repo is that faucet, once, reusable, and hardened. It's also built behind a `CurrencyDriver` interface so the same core can back payout systems for other chains later.

## Quick start

One compose command brings up the faucet server and a `core-rs-albatross` testnet node it talks to:

```bash
git clone https://github.com/PanoramicRum/nimiq-simple-faucet
cd nimiq-simple-faucet/deploy/compose
cp .env.example .env           # edit FAUCET_ADMIN_PASSWORD + wallet credentials
docker compose --profile local-node up -d
```

Initial testnet sync takes a few minutes (`docker compose logs -f nimiq` to watch). Once consensus is established, open `http://localhost:8080/admin`, finish TOTP setup, and the faucet issues claims.

Wallet setup, external-RPC alternative, Postgres profile, smoke tests: see **[deploy/compose/README.md](deploy/compose/README.md)**. For Kubernetes see **[deploy/helm/](deploy/helm/)**.

### Just smoke-testing the image?

```bash
docker run -d --name nimiq-faucet -p 8080:8080 -v faucet-data:/data \
  -e FAUCET_NETWORK=test \
  -e FAUCET_SIGNER_DRIVER=wasm \
  -e FAUCET_PRIVATE_KEY="$(openssl rand -hex 32)" \
  -e FAUCET_ADMIN_PASSWORD=change-me \
  -e FAUCET_KEY_PASSPHRASE=change-me-too \
  ghcr.io/panoramicrum/nimiq-simple-faucet:latest
```

Boots a self-contained WASM faucet. The WASM client reaches TestAlbatross consensus within ~15 seconds (fixed in v1.1.4); `/healthz` and `/admin` are reachable immediately (v1.1.0). For a full end-to-end demo with a local RPC node, use the compose path above.

## Integrate into your app

| Framework     | Package                           | One-liner                                                  |
| ------------- | --------------------------------- | ---------------------------------------------------------- |
| TypeScript    | `@nimiq-faucet/sdk`               | `new FaucetClient({ url }).claim(address)`                 |
| React         | `@nimiq-faucet/react`             | `useFaucetClaim({ address, hostContext })`                 |
| Vue 3         | `@nimiq-faucet/vue`               | `useFaucetClaim({ address, hostContext })`                 |
| Capacitor     | `@nimiq-faucet/capacitor`         | Wraps sdk-ts, adds native device-id capture                |
| React Native  | `@nimiq-faucet/react-native`      | RN-safe fetch / WS polyfills + `react-native-device-info`  |
| Flutter       | `nimiq_faucet` (pub.dev)          | `FaucetClient(url: ...).claim(address)`                    |
| Go            | `github.com/PanoramicRum/nimiq-simple-faucet/packages/sdk-go` | `client.Claim(ctx, address)`                             |
| Python        | `nimiq-faucet` (PyPI)             | `FaucetClient(url).claim(address)`                         |
| Any language  | `openapi.yaml`                    | `openapi-generator-cli generate …`                         |

Every SDK accepts the same `hostContext` (hashed UID, cookie hash, session hash, account age, KYC level, tags, HMAC signature) so your project's own abuse signals flow into the faucet's scoring pipeline.

## Abuse prevention (10 pluggable layers, rate-limiting on by default)

1. **Blocklist** — IP, address, UID, ASN, or country deny-list with optional expiry.
2. **Rate limiting** — per-IP daily cap (default 5 claims/day).
3. **Cloudflare Turnstile** — captcha challenge (opt-in via env).
4. **hCaptcha** — alternative captcha provider (opt-in via env).
5. **FCaptcha** — self-hosted MIT CAPTCHA combining PoW with behavioural + environmental detection ([upstream](https://github.com/WebDecoy/FCaptcha)).
6. **Hashcash** — self-hosted SHA-256 client puzzle; anti-bot without third-party deps (unrelated to Nimiq's proof-of-stake consensus).
7. **Geo-IP / ASN** — DB-IP Lite (zero-config default), MaxMind, or IPinfo. VPN/datacenter/Tor blocking, country allow/deny-list.
8. **Device fingerprint** — visitor-ID + host-provided UID / cookie correlation.
9. **On-chain heuristics** — sweeper-address detection, fresh-address scoring.
10. **AI anomaly scoring** — deterministic rules + small ONNX classifier (CPU-only).

Each layer emits signals that can be inspected per claim in the dashboard and retrieved via the MCP tool `faucet.explain_decision`. See [detailed per-layer documentation](./docs/abuse-layers/) for configuration, provider options, and how to add your own.

## AI agent integration

- MCP server at `/mcp` — `faucet.claim`, `faucet.stats`, `faucet.explain_decision`, `faucet.balance`, `faucet.block_address`, etc. Point Claude Code / Cursor / any MCP client at it.
- `AGENTS.md` — one-prompt recipes for adding a faucet to a new app.
- `/llms.txt` and `/llms-full.txt` — stable, scrapable integration surface for web-search-based coding agents.
- Per-framework snippet pages at `/snippets/<framework>` regenerated on each release.

## Repository layout

See [CONTRIBUTING.md](./CONTRIBUTING.md) for a complete tour. Short version:

- `apps/server` — Fastify + TS server (REST, WS, MCP, admin API).
- `apps/claim-ui` — Faucet Frontend: ClaimUI (claim form), Dashboard (status + activity log), AdminDashboard (coming soon). See [docs/claim-ui.md](./docs/claim-ui.md).
- `apps/dashboard` — Vue 3 admin UI (session-authenticated).
- `apps/playground` — VitePress developer playground ([GitHub Pages](https://panoramicrum.github.io/nimiq-simple-faucet/)).
- `apps/docs` — VitePress docs + llms.txt.
- `packages/core` — driver interfaces, abuse pipeline (`AbuseCheck` contract).
- `packages/driver-nimiq-*` — WASM and JSON-RPC signers.
- `packages/abuse-*` — 10 pluggable abuse providers. See [docs/abuse-layers/](./docs/abuse-layers/).
- `packages/sdk-*` — 8 first-party client SDKs (TS, React, Vue, Python, Go, Flutter, Capacitor, React Native).
- `packages/openapi` — OpenAPI 3.1 spec generated from server route schemas.
- `deploy/{docker,compose,helm}` — deployment artifacts.
- `examples/*` — minimal integration examples per framework.

## Release

User-visible changes get a Changeset: run `pnpm changeset`, describe the
change, commit the generated `.changeset/*.md` with your PR. Maintainers cut
a release by pushing a `vX.Y.Z` git tag; `.github/workflows/release.yml`
takes over — it builds and publishes the multi-arch container image to GHCR,
publishes `@nimiq-faucet/*` npm packages, pushes the Helm chart to
`oci://ghcr.io/nimiq/charts`, opens the OpenAPI freeze PR, and creates the
GitHub Release. `.github/workflows/sbom.yml` then attaches CycloneDX SBOMs
for both the image and the workspace.

## Acknowledgements

This faucet stands on the shoulders of the open-source projects below. Huge thanks to every maintainer and contributor behind them.

**Nimiq ecosystem**
- [Nimiq](https://nimiq.com) — [`@nimiq/core`](https://github.com/nimiq/core-rs-albatross) WASM web-client and [core-rs-albatross](https://github.com/nimiq/core-rs-albatross) node. Testnet seed peers confirmed by the Nimiq maintainers.

**Server runtime**
- [Fastify](https://fastify.dev/) + [`@fastify/cors`](https://github.com/fastify/fastify-cors), [`@fastify/helmet`](https://github.com/fastify/fastify-helmet), [`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit), [`@fastify/static`](https://github.com/fastify/fastify-static), [`@fastify/cookie`](https://github.com/fastify/fastify-cookie), [`@fastify/websocket`](https://github.com/fastify/fastify-websocket)
- [Zod](https://zod.dev/) with [zod-to-openapi](https://github.com/asteasolutions/zod-to-openapi) and [fastify-type-provider-zod](https://github.com/turkerdev/fastify-type-provider-zod)
- [Drizzle ORM](https://orm.drizzle.team/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [node-postgres](https://node-postgres.com/), [ioredis](https://github.com/redis/ioredis)
- [pino](https://getpino.io/), [prom-client](https://github.com/siimon/prom-client), [undici](https://undici.nodejs.org/), [nanoid](https://github.com/ai/nanoid)

**Cryptography**
- [`@noble/ciphers`](https://github.com/paulmillr/noble-ciphers) + [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) by [Paul Miller](https://paulmillr.com/) — XChaCha20-Poly1305, SHA-256
- [`@node-rs/argon2`](https://github.com/napi-rs/node-rs) — Argon2id KDF
- [otplib](https://github.com/yeojz/otplib) — TOTP

**Abuse-prevention providers**
- [Cloudflare Turnstile](https://www.cloudflare.com/application-services/products/turnstile/), [hCaptcha](https://www.hcaptcha.com/), [FCaptcha](https://github.com/WebDecoy/FCaptcha) (self-hosted)
- [MaxMind GeoLite2](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/), [IPinfo](https://ipinfo.io/), [DB-IP](https://db-ip.com/) (via [ip-location-db](https://github.com/sapics/ip-location-db))
- [ONNX Runtime](https://onnxruntime.ai/)

**Frontend + playground**
- [Vue 3](https://vuejs.org/), [Vue Router](https://router.vuejs.org/), [Pinia](https://pinia.vuejs.org/)
- [Vite](https://vitejs.dev/), [VitePress](https://vitepress.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn-vue](https://www.shadcn-vue.com/) — accessible component primitives for the admin dashboard

**Cross-platform SDKs**
- [Capacitor](https://capacitorjs.com/) (Ionic), [React Native](https://reactnative.dev/), [Flutter](https://flutter.dev/)

**AI-agent integration**
- [Model Context Protocol](https://modelcontextprotocol.io/) — [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) by Anthropic

**Tooling + QA**
- [TypeScript](https://www.typescriptlang.org/), [pnpm](https://pnpm.io/), [Turborepo](https://turbo.build/)
- [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/) + [axe-core](https://github.com/dequelabs/axe-core)
- [Changesets](https://github.com/changesets/changesets), [Prettier](https://prettier.io/), [tsx](https://github.com/privatenumber/tsx)

**Security scanning (CI)**
- [CodeQL](https://codeql.github.com/), [Trivy](https://trivy.dev/) (Aqua Security), [Gitleaks](https://github.com/gitleaks/gitleaks)

**Infrastructure + ops**
- [Docker](https://www.docker.com/), [Kubernetes](https://kubernetes.io/) + [Helm](https://helm.sh/)
- [Prometheus](https://prometheus.io/) + [Grafana](https://grafana.com/)

If you maintain one of these projects and we've misattributed or missed something, please open an issue — we'd like to get it right.

## License

MIT. See [LICENSE](./LICENSE).
