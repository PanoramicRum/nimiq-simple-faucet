# ClaimUI

The public-facing claim interface for the Nimiq Simple Faucet. Built with Vue 3, Tailwind 4, and Vue Router. Designed around the "Porcelain Vault" visual identity with the maneki-neko (lucky cat) mascot.

## Overview

ClaimUI is a single-page application with 3 routes:

| Route | Purpose |
|-------|---------|
| `/` | **Homepage** — maneki-neko hero, address input, challenge widgets, claim button |
| `/status` | **Status dashboard** — faucet balance, claim/blocked counters, recent claims, system health |
| `/log` | **Activity log** — paginated claim history with detail modal |

The app is fully self-configuring: it fetches `/v1/config` on load and adapts its UI based on which abuse layers the server has enabled. No client-side configuration is needed.

## Architecture

```
ClaimUI (Vue 3 SPA)
  │
  ├── GET /v1/config          → determines which challenge widgets to show
  ├── POST /v1/claim          → submits the claim with challenge solution
  ├── GET /v1/claim/:id       → polls claim status
  ├── WS /v1/stream           → real-time claim events
  ├── GET /v1/stats/summary   → status dashboard data
  ├── GET /v1/claims/recent   → activity log data
  ├── GET /v1/events          → system events
  └── GET /readyz             → health check
```

The server decides which abuse layers are active. The ClaimUI reads the config and conditionally renders the appropriate challenge widget. When the server enables Turnstile, the UI shows a Turnstile widget. When it enables hashcash, a Web Worker starts solving. The developer deploying the faucet only needs to set environment variables on the server — the UI adapts automatically.

## Abuse layer UI components

ClaimUI includes built-in components for 3 client-facing abuse layers:

### TurnstileWidget

Renders the Cloudflare Turnstile invisible challenge. Loads the Turnstile script from CDN, renders the widget, and emits the verification token via `v-model`. Auto-resets on error.

**Shown when:** `config.captcha.provider === 'turnstile'`

### HCaptchaWidget

Renders the hCaptcha challenge (visual or invisible depending on hCaptcha dashboard config). Same pattern as Turnstile — loads script, renders, emits token.

**Shown when:** `config.captcha.provider === 'hcaptcha'`

### HashcashRunner

Spawns a Web Worker that brute-forces SHA-256 hashes to solve the server-issued challenge. Shows a progress bar with attempt counter. Emits the solved `challenge#nonce` string.

**Shown when:** `config.hashcash` is present (hashcash secret is set on server)

### Challenge flow

The challenge widgets are mutually exclusive (priority: Turnstile > hCaptcha > Hashcash). The claim button (the cat mascot) stays disabled until:

1. A valid Nimiq address is entered
2. The active challenge is satisfied (captcha token obtained or hashcash solved)

When both conditions are met, the cat becomes clickable and triggers the claim.

## Reusing ClaimUI

ClaimUI is designed to be forkable. To use it for your own Nimiq faucet:

### Quick start

```bash
# Clone and install
git clone https://github.com/PanoramicRum/nimiq-simple-faucet
cd nimiq-simple-faucet
pnpm install

# Build ClaimUI
pnpm --filter @nimiq-faucet/claim-ui build

# The dist/ folder is a static SPA — serve it behind your faucet server
```

### What to customize

| What | Where | Notes |
|------|-------|-------|
| **Mascot image** | `apps/claim-ui/public/cat.png` | Replace with your own image |
| **Brand name** | `src/views/HomePage.vue` | "Nimiq Faucet" heading |
| **Colors** | `tailwind.config.ts` | Stitch design tokens (surface tiers, primary gold) |
| **Fonts** | `index.html` + `src/styles.css` | Plus Jakarta Sans, Manrope, Fira Code |
| **Footer** | `src/components/FooterBar.vue` | Credit line and links |
| **NavBar** | `src/components/NavBar.vue` | Brand, badge, navigation links |

### What to keep

- `src/components/ClaimStatus.vue` — claim lifecycle tracking (WS + polling)
- `src/components/TurnstileWidget.vue` — Turnstile integration
- `src/components/HCaptchaWidget.vue` — hCaptcha integration
- `src/components/HashcashRunner.vue` — hashcash Web Worker
- `src/lib/client.ts` — FaucetClient from `@nimiq-faucet/sdk`
- `src/lib/validate.ts` — Nimiq address validation
- `src/lib/format.ts` — shared formatting utilities

These components are generic and work with any faucet server that implements the same API.

## Customizing the theme

ClaimUI uses the "Porcelain Vault" design system from Stitch:

### Color tokens (Tailwind)

```
surface:                #fcf9f3   (page background)
surface-container-low:  #f6f3ed   (section backgrounds)
surface-container:      #f1ede7   (card backgrounds)
surface-container-high: #ebe8e2   (input backgrounds)
surface-container-lowest: #ffffff (elevated cards)
on-surface:             #1c1c18   (primary text)
on-surface-variant:     #4f4633   (muted text)
primary:                #785a00   (links, labels)
primary-container:      #e9b213   (Nimiq gold — buttons, accents)
error:                  #ba1a1a   (danger states)
```

### Font stack

| Role | Font | Usage |
|------|------|-------|
| Headlines | Plus Jakarta Sans | Page titles, section headers |
| Body | Manrope | Paragraphs, descriptions |
| Labels | Space Grotesk | Buttons, badges |
| Mono | Fira Code | Addresses, hashes, data |

### Design rules

- **No explicit borders** — use background tonal shifts (surface tiers) for visual separation
- **Elevation** via surface stacking, not drop shadows
- **16px border radius** for cards, **rounded-full** for buttons and badges
- **Gold accent** (`#e9b213`) for primary actions only

## API integration

| Endpoint | Method | Used by | Polling |
|----------|--------|---------|---------|
| `/v1/config` | GET | App shell (NavBar network badge) + HomePage (challenge selection) | Once on load |
| `/v1/claim` | POST | HomePage (claim submission) | — |
| `/v1/claim/:id` | GET | ClaimStatus (fallback polling) | Every 2s until confirmed |
| `/v1/stream` | WS | ClaimStatus (real-time events) | Persistent connection |
| `/v1/stats/summary` | GET | StatusPage (performance cards) | Every 30s |
| `/v1/claims/recent` | GET | ActivityLog (paginated list) | On navigation + filter change |
| `/v1/events` | GET | StatusPage (system events) | Every 60s |
| `/readyz` | GET | StatusPage (health indicator) | Every 30s |

## Admin Dashboard (coming soon)

An operator-facing admin dashboard is planned as an extension to ClaimUI. It will provide:

- **Wallet management** — display faucet address, current balance, fund/withdraw
- **Claim review** — approve/deny pending claims, view abuse signals
- **Blocklist management** — add/remove IP, address, ASN, country blocks
- **Configuration** — runtime abuse layer toggles, rate limit tuning
- **Audit log** — admin action history

The existing admin dashboard (`apps/dashboard/`) provides these features behind session auth. The planned extension will integrate them into the ClaimUI experience with a unified design.

See [ROADMAP.md §3.0.8](../ROADMAP.md) for status and scope.
