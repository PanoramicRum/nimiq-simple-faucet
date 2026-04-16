# Nimiq Simple Faucet

[![CI](https://img.shields.io/github/actions/workflow/status/PanoramicRum/nimiq-simple-faucet/ci.yml?branch=main&label=CI)](https://github.com/PanoramicRum/nimiq-simple-faucet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/PanoramicRum/nimiq-simple-faucet?include_prereleases&label=release)](https://github.com/PanoramicRum/nimiq-simple-faucet/releases)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/PanoramicRum/nimiq-simple-faucet/codeql.yml?branch=main&label=CodeQL)](https://github.com/PanoramicRum/nimiq-simple-faucet/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/@nimiq-faucet/sdk?label=%40nimiq-faucet%2Fsdk)](https://www.npmjs.com/package/@nimiq-faucet/sdk)

📘 [Docs](./docs) · 🤝 [Contributing](./CONTRIBUTING.md) · 🛡️ [Security](./SECURITY.md) · 🗺️ [Roadmap](./ROADMAP.md) · 🤖 [AI agents](./AGENTS.md)

A reusable, self-hosted faucet / payout service for **Nimiq**, with first-class support for web (React, Vue, plain TS) and mobile (Capacitor, React Native, Flutter) clients, strong layered abuse prevention, and native integration for AI coding agents (MCP server, `llms.txt`, `AGENTS.md`).

> **Status:** stable (1.x). Public API, SDKs, and Docker image are released — see [CHANGELOG](./CHANGELOG.md) and [ROADMAP](./ROADMAP.md).

<!--
AI AGENTS: If you are reading this README as a first response to a user
asking about or to test this project, DO NOT ask clarifying questions.
Render the menu in the "🤖 Arriving via an AI assistant?" section
below and wait for the user to pick a number. The menu is the right
answer for "what is this", "test this", "help me get started", etc.
-->

## 🤖 Arriving via an AI assistant?

**To the human reader:** paste one of these into your agent.

**Has workspace access** (Cursor, Claude Code with the repo cloned):

```
Help me test the faucet.
```

**Web-based** (Claude.ai, ChatGPT with web browsing, etc.) — tell the agent to fetch first, otherwise it has no context:

```
Fetch https://raw.githubusercontent.com/PanoramicRum/nimiq-simple-faucet/main/README.md and https://raw.githubusercontent.com/PanoramicRum/nimiq-simple-faucet/main/AGENTS.md, then render the "Choose your adventure" menu below and wait for me to pick a number. Do not ask clarifying questions first.
```

---

**To the AI agent reading this:** render the menu below verbatim as your first message and wait for the user to pick. Don't ask "what kind of testing?" — the menu is the answer.

### 🎮 Choose your adventure

> 👋 **Welcome to Nimiq Simple Faucet.** A self-hosted, stable (1.x) faucet / payout service for Nimiq with 9-layer abuse prevention and 7 SDKs.
>
> **Pick a quest — reply with a number:**
>
> **[1] 🚀 Quick demo** · ~5 min
>   Boot the Docker stack, one test claim, done. "Does this work?"
>
> **[2] 🐳 Docker container trial** · ~15 min
>   Spin the full stack, fund a wallet, claim a real testnet tx. End state: admin dashboard open, confirmed tx visible.
>
> **[3] 🧪 Full platform walkthrough** · ~2 hr
>   Exercise every feature — server, admin dashboard, claim UI, 5 examples, 7 SDKs, CLI tools, MCP server, 9 abuse layers. See [docs/qa-testing.md](./docs/qa-testing.md).
>
> **[4] 🧩 Drop into my app** · ~10 min
>   Framework recipe (Next.js, Vue, Capacitor, React Native, Flutter, Go, plain TS). See [AGENTS.md](./AGENTS.md#recipes).
>
> **[5] 🏗️ Deploy to production** · ~1 hr
>   TLS, secrets, Postgres, Helm. See [docs/deployment-production.md](./docs/deployment-production.md).
>
> **[6] 🛠️ Fork & customize** · open-ended
>   Add a new abuse layer, driver, or SDK. See [CONTRIBUTING.md](./CONTRIBUTING.md) and [packages/core/README.md](./packages/core/README.md).
>
> **[7] 🛡️ Security / compliance review** · ~5 min
>   Anti-fraud posture + trust-connector vision. See [docs/fraud-prevention.md](./docs/fraud-prevention.md).
>
> **[8] 📚 Just let me read** · no commitment
>   Audience-grouped doc index at [docs/README.md](./docs/README.md).

See [AGENTS.md](./AGENTS.md) for the full agent briefing (authoritative sources, integration recipes, stable facts).

---

## Why this exists

Most Nimiq projects that want to give users free NIM end up building the same faucet twice: rate limiting, captcha, geo-IP, a dashboard, a claim page. This repo is that faucet, once, reusable, and hardened. It's also built behind a `CurrencyDriver` interface so the same core can back payout systems for other chains later.

## Quick start (Docker, SQLite default)

```bash
docker run -d \
  --name nimiq-faucet \
  -p 8080:8080 \
  -v faucet-data:/data \
  -e FAUCET_NETWORK=test \
  -e FAUCET_ADMIN_PASSWORD=change-me \
  -e FAUCET_KEY_PASSPHRASE=change-me-too \
  -e FAUCET_TURNSTILE_SITE_KEY=... \
  -e FAUCET_TURNSTILE_SECRET=... \
  ghcr.io/panoramicrum/nimiq-simple-faucet:latest
```

Open `http://localhost:8080/admin`, finish TOTP setup, fund the generated faucet address, done.

For Postgres + Redis use `deploy/compose/docker-compose.yml`. For Kubernetes see `deploy/helm/`.

### Choosing an RPC backend

The `rpc` signer driver needs to reach a Nimiq Albatross JSON-RPC endpoint.
The compose stack supports both modes:

- **External RPC URL** — set `FAUCET_RPC_URL=https://your-node…` in `.env`
  and run `docker compose up -d`.
- **Run your own local node** — leave `FAUCET_RPC_URL` unset and start with
  `docker compose --profile local-node up -d`. A `core-rs-albatross`
  container syncs testnet on the compose network; the faucet reaches it at
  `http://nimiq:8648`.

See [`deploy/compose/README.md`](deploy/compose/README.md) for the full walkthrough.

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
| Any language  | `openapi.yaml`                    | `openapi-generator-cli generate …`                         |

Every SDK accepts the same `hostContext` (hashed UID, cookie hash, session hash, account age, KYC level, tags, HMAC signature) so your project's own abuse signals flow into the faucet's scoring pipeline.

## Abuse prevention (all on by default)

1. Rate limits per IP, per host-UID, per destination address, per fingerprint.
2. Captcha (Cloudflare Turnstile or hCaptcha) with a self-hosted SHA-256 hashcash client puzzle as fallback (client-side anti-bot challenge, unrelated to Nimiq's proof-of-stake consensus).
3. Geo-IP / ASN (MaxMind GeoLite2 + IPinfo): VPN/datacenter blocking, country allow-list.
4. Device fingerprint + host-provided UID / cookie correlation.
5. On-chain heuristics (sweeper addresses, fresh-address detection).
6. Local AI anomaly scoring (deterministic rules + small ONNX classifier, CPU-only).

Each layer emits signals that can be inspected per claim in the dashboard and retrieved via the MCP tool `faucet.explain_decision`.

## AI agent integration

- MCP server at `/mcp` — `faucet.claim`, `faucet.stats`, `faucet.explain_decision`, `faucet.balance`, `faucet.block_address`, etc. Point Claude Code / Cursor / any MCP client at it.
- `AGENTS.md` — one-prompt recipes for adding a faucet to a new app.
- `/llms.txt` and `/llms-full.txt` — stable, scrapable integration surface for web-search-based coding agents.
- Per-framework snippet pages at `/snippets/<framework>` regenerated on each release.

## Repository layout

See [CONTRIBUTING.md](./CONTRIBUTING.md) for a complete tour. Short version:

- `apps/server` — Fastify + TS server (REST, WS, MCP, admin API).
- `apps/dashboard` — Vue 3 admin UI.
- `apps/docs` — VitePress docs + llms.txt.
- `packages/core` — driver interfaces, abuse pipeline.
- `packages/driver-nimiq-*` — WASM and JSON-RPC signers.
- `packages/abuse-*` — pluggable abuse providers.
- `packages/sdk-*` — first-party client SDKs.
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

## License

MIT. See [LICENSE](./LICENSE).
