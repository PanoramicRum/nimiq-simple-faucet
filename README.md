# Nimiq Simple Faucet

A reusable, self-hosted faucet / payout service for **Nimiq**, with first-class support for web (React, Vue, plain TS) and mobile (Capacitor, React Native, Flutter) clients, strong layered abuse prevention, and native integration for AI coding agents (MCP server, `llms.txt`, `AGENTS.md`).

> **Status:** pre-release (0.x). Core APIs are stable; working toward 1.0.

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

See the approved plan. Short version:

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
