# Nimiq PoW — alternative Claim UI theme

Visual tribute to the original [`nimiq/web-miner`](https://github.com/nimiq/web-miner) (live at [miner.nimiq-testnet.com](https://miner.nimiq-testnet.com/)). Animated world-dot map + peer-pulse network visualization, dark-navy palette, claim-NIM CTA at the bottom.

**This is decorative.** The old web-miner ran actual proof-of-work in the browser; this theme does not. The claim flow is the same plain HTTP `client.solveAndClaim` (or `client.claim`) used by every other theme — the visualization just suggests network activity.

## Switch to this theme

```bash
# Local dev
FAUCET_CLAIM_UI_THEME=nimiq-pow pnpm --filter @faucet/server start

# Docker (once the multi-theme image lands in PR #4)
docker run -e FAUCET_CLAIM_UI_THEME=nimiq-pow ghcr.io/panoramicrum/nimiq-simple-faucet:latest
```

The default theme remains [`porcelain-vault`](../claim-ui/) — see [`docs/contributing-a-frontend.md`](../../docs/contributing-a-frontend.md) for the multi-theme system and how to ship your own.

## Run locally

```bash
# From repo root
pnpm install
pnpm --filter @nimiq-faucet/nimiq-pow-ui dev
# Open http://localhost:5174
```

The dev server proxies `/v1/*` to a faucet on `http://localhost:8080` (override with `FAUCET_PORT=...`). For a full stack:

```bash
cd deploy/compose && cp .env.example .env  # edit credentials
docker compose --profile local-node up -d  # faucet + nimiq node
# Then in another terminal:
pnpm --filter @nimiq-faucet/nimiq-pow-ui dev
```

## What's in the box

| File | Purpose |
|---|---|
| [`src/App.vue`](src/App.vue) | Layout: header + hero panel + map background + footer |
| [`src/components/WorldMap.vue`](src/components/WorldMap.vue) | Canvas-based dot grid with continent silhouette + peer-pulse animation |
| [`src/components/ConnectWallet.vue`](src/components/ConnectWallet.vue) | **Nimiq Hub-API connect button** primary; paste-address fallback for users without a Hub account or in restricted WebViews |
| [`src/components/ClaimButton.vue`](src/components/ClaimButton.vue) | Pulsing gold CTA |
| [`src/components/StatusBar.vue`](src/components/StatusBar.vue) | Phase / tx / error display |
| [`src/components/FooterBar.vue`](src/components/FooterBar.vue) | Footer + GitHub + web-miner credit |
| [`src/composables/useHub.ts`](src/composables/useHub.ts) | Wraps `@nimiq/hub-api`. Picks endpoint (mainnet vs. testnet) from `/v1/config.network`. Calls `chooseAddress` — the page never sees keys. |
| [`src/composables/useClaim.ts`](src/composables/useClaim.ts) | Wraps `FaucetClient`, reads `/v1/config`, runs `solveAndClaim` when hashcash is enabled |

## Wallet connection — Nimiq Hub

The primary connect path uses the [Nimiq Hub](https://hub.nimiq.com) (testnet: [hub.nimiq-testnet.com](https://hub.nimiq-testnet.com)). One click pops the Hub in its own origin; the user authenticates there and picks an account; we receive `{ address, label }` back. **No keys ever touch this page** — the faucet's job is to *send* NIM to an address, not to sign anything on the user's behalf.

The Hub endpoint is selected automatically from `/v1/config.network`:
- `network: 'main'` → `https://hub.nimiq.com`
- `network: 'test'` → `https://hub.nimiq-testnet.com`

If the user closes the popup, the error is silently swallowed (no scary message for "I changed my mind"). Real errors (popup blocked, Hub unreachable) surface in red beneath the button.

A paste-address fallback is one click away — useful when the user doesn't have a Hub account yet, or the Hub popup is blocked (some mobile WebViews / strict CSPs). The fallback emits the same `update:modelValue` shape so the parent never sees the difference.

## Roadmap

- **v1**: paste-address claim, decorative network animation. Shipped in [PR #148](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/148).
- **v1.1 (§3.0.15)**: ✅ Hub-API wallet connect — primary connect path; paste-address kept as fallback. Shipped in [PR #150](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/150).
- **Future (§3.0.16)**: user-facing theme picker so visitors can swap between bundled themes from the UI.
- **Future (community)**: more themes — see [Future ideas](../../ROADMAP.md#future-ideas-community-contributions-wanted).

## Credits

The old [`nimiq/web-miner`](https://github.com/nimiq/web-miner) is the visual inspiration. Their dot-map + peer-pulse aesthetic was the defining look of early Nimiq; recreating it as a faucet theme felt right. The PoW mechanic itself is intentionally not reproduced here — the faucet is the source of NIM, not the user's CPU.
