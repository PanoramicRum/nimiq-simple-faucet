# Nimiq Simple Faucet — Playground & UI Design Brief

## Purpose

This document is the source of truth for the visual design of the Nimiq Simple Faucet's public-facing UI overhaul. It contains brand guidelines, component specs, and **ready-to-use Stitch prompts** for generating design concepts.

**Workflow:** paste each Stitch prompt section into Stitch, iterate until you like the direction, then bring the approved designs to the implementation phase.

---

## 1. Brand Identity

**Who we are:** A self-hosted, production-grade crypto faucet for the Nimiq blockchain. Our audience is developers integrating NIM payouts into their apps.

**Visual personality:**
- **Technical but approachable** — developer-tool seriousness without being cold
- **Dark-mode-first** — code-friendly, easy on the eyes, professional
- **Nimiq's warmth** — gold/amber accent cuts through the dark theme
- **Clean and spacious** — generous whitespace, clear hierarchy, no clutter

**Reference points:** Stripe's dashboard, Linear's UI, Vercel's developer experience, Nimiq's own brand at nimiq.com.

---

## 2. Color System

### Primary palette

| Token | Hex | Usage |
|-------|-----|-------|
| `nimiq-500` | `#f9bf26` | Primary accent — buttons, links, focus rings, highlights |
| `nimiq-400` | `#fbcd4c` | Hover state on primary |
| `nimiq-600` | `#c4940d` | Pressed state / active |
| `nimiq-700` | `#9a7209` | Dark accent (badges, subtle highlights) |

### Surfaces (dark mode — primary)

| Token | Hex | Usage |
|-------|-----|-------|
| `surface-dark` | `#14110c` | Page background |
| `surface-darkMuted` | `#1d1a14` | Card background, sidebar |
| `card-border` | `#2a2520` | Subtle borders |
| `row-hover` | `#252118` | Table row hover |

### Surfaces (light mode — secondary)

| Token | Hex | Usage |
|-------|-----|-------|
| `surface` | `#ffffff` | Page background |
| `surface-muted` | `#f5f4ef` | Card background |
| `card-border-light` | `#e8e6df` | Subtle borders |

### Semantic

| Token | Hex | Usage |
|-------|-----|-------|
| `success` | `#22c55e` (green-500) | Confirmed, success states |
| `error` | `#ef4444` (red-500) | Rejected, errors |
| `warning` | `#f59e0b` (amber-500) | Timeouts, pending attention |
| `info` | `#3b82f6` (blue-500) | Informational badges |

### Code syntax theme

Use a warm dark theme (e.g., One Dark Pro variant with Nimiq gold for keywords). Monospace font: `JetBrains Mono` or `Fira Code` (ligatures optional).

---

## 3. Typography

| Role | Font | Size | Weight |
|------|------|------|--------|
| H1 (page title) | System sans-serif | 1.5rem (24px) | 700 (bold) |
| H2 (section) | System sans-serif | 1.25rem (20px) | 600 (semibold) |
| H3 (card title) | System sans-serif | 1rem (16px) | 600 |
| Body | System sans-serif | 0.875rem (14px) | 400 |
| Small / muted | System sans-serif | 0.75rem (12px) | 400 |
| Code / mono | JetBrains Mono, Fira Code, monospace | 0.8125rem (13px) | 400 |
| Address (Nimiq) | Monospace | 0.875rem | 400, letter-spacing: 0.1em |

---

## 4. Component Inventory

### Buttons
- **Primary** — nimiq-500 background, dark text, rounded-lg, hover: nimiq-400
- **Secondary** — transparent with border, text color, hover: subtle bg
- **Danger** — red-500 background, white text
- **Ghost** — no border, text only, hover: subtle bg
- All: focus-visible ring (nimiq-500), disabled: opacity-60

### Cards
- Dark muted background, 1px subtle border, rounded-xl, shadow-sm
- Padding: 1.5rem (24px)

### Form inputs
- Dark input background, subtle border, rounded-md
- Focus: nimiq-500 ring
- Labels above inputs, helper text below

### Status badges
- Rounded pill shape, small font
- `broadcast` → amber/yellow
- `confirmed` → green
- `rejected` → red
- `challenged` → orange
- `timeout` → gray
- `expired` → dark red

### Data tables
- Striped rows (alternating surface tones), sticky header
- Sortable columns with chevron indicators
- Pagination at bottom

### Code blocks
- Dark background (darker than card), rounded-lg
- Syntax highlighted (Shiki or similar)
- Copy button in top-right corner
- Language badge in top-left

### Charts (admin dashboard)
- Line/area charts for time-series (claim rate, latency)
- Stat cards with large number + trend indicator
- Use nimiq-500 for primary series, muted grays for secondary

---

## 5. Page Layouts

### 5.1 Claim UI (4-step flow)

**Layout:** centered card (max-w-lg), vertically stacked steps with a progress indicator at the top.

**Step 1 — Enter address:**
- Nimiq address input (monospace, large)
- Network badge (testnet/mainnet)
- "Claim" button (primary)

**Step 2 — Challenge (if required):**
- Turnstile/hCaptcha widget OR hashcash progress bar
- "Solving..." animated state

**Step 3 — Submitting:**
- Spinner + "Broadcasting transaction..."
- Claim ID shown

**Step 4 — Result:**
- Success: green checkmark, tx ID (monospace, clickable → explorer), amount
- Failure: red X, error message, retry button
- Animated transition from step 3 → 4

### 5.2 Admin Dashboard

**Layout:** fixed sidebar (collapsible) + scrollable main content.

**Sidebar:** Logo at top, nav items with icons (Overview, Claims, Blocklist, Integrators, Config, Account, Logs), active state highlighted in nimiq-500.

**Overview page:** 4 stat cards (balance, claims/hr, success rate, driver status) + 2 charts (claim rate 24h, latency p95) + top rejection reasons table.

**Claims page:** data table with status badges, search/filter bar, explain drawer on row click.

**Config page:** form with section headers, layer toggle switches, save button, restart-required banner.

### 5.3 Playground Landing

**Layout:** full-width hero → framework grid → footer.

**Hero:** "Try the Nimiq Faucet" headline, "Claim testnet NIM in 3 clicks" subtitle, embedded mini claim form (just the address input + claim button).

**Framework grid:** 8 cards (TypeScript, React, Vue, Python, Go, Flutter, Capacitor, React Native), each with the framework logo, a 3-line code snippet preview, and a "Try it" button.

**Below the fold:** API explorer link, docs link, GitHub link.

### 5.4 SDK Showcase Panel

**Layout:** split view — code on left (60%), result on right (40%).

**Code panel:** syntax-highlighted read-only editor with the minimal claim example. Copy button. Language/framework badge.

**Result panel:** same claim result card as the claim UI (step 4). "Run" button at the bottom triggers the claim. Terminal-style request/response log for server-side SDKs (Python, Go).

---

## 6. Motion & Animation

- **Step transitions:** slide-left (forward) / slide-right (back), 200ms ease-out
- **Status change:** fade-in for result card, subtle scale-up (1.02→1.0)
- **Loading:** pulsing shimmer on stat cards, spinning ring on buttons
- **Success celebration:** brief confetti burst or checkmark draw animation
- **Sidebar collapse:** 150ms width transition

---

## 7. Stitch Prompts

Copy each prompt below into Stitch to generate design concepts.

### Prompt 1: Claim UI — Full 4-step flow

```
Design a dark-mode faucet claim page for Nimiq (a cryptocurrency). The page has a single centered card (max 480px wide) with 4 steps, shown one at a time with a progress indicator at the top (4 dots/steps).

Step 1: "Enter your Nimiq address" — large monospace input field for a crypto address (format: NQ00 0000 0000 0000 0000 0000 0000 0000 0000), a network badge reading "Testnet", and a gold "Claim 1 NIM" button.

Step 2: "Verifying..." — a hashcash challenge progress bar (60% complete), text "Solving client puzzle... 4,096 hashes".

Step 3: "Broadcasting..." — a spinner, text "Transaction submitted", and a claim ID in monospace.

Step 4 (success): Green checkmark icon, "1 NIM sent!", transaction hash as a clickable monospace link, and a "Claim another" ghost button.

Color palette: background #14110c (very dark brown-black), card #1d1a14, primary accent #f9bf26 (warm gold), text #e8e6df. Border radius: 16px for card, 8px for inputs/buttons. Font: system sans-serif for UI, monospace for addresses/hashes. Clean, spacious, developer-tool aesthetic. Similar to Stripe's checkout or Vercel's dashboard.
```

### Prompt 2: Admin Dashboard — Overview page

```
Design a dark-mode admin dashboard overview page for a crypto faucet management tool. Left sidebar (240px, collapsible) with navigation: Overview (active), Claims, Blocklist, Integrators, Config, Account, Logs. A small faucet logo at the top.

Main content area has:
- Top row: 4 stat cards in a grid — "Wallet Balance: 42.5 NIM", "Claims / hour: 12", "Success Rate: 94%", "Driver: Ready" (green dot). Each card has a subtle trend arrow.
- Middle: 2 charts side by side — "Claim Rate (24h)" line chart and "Latency p95 (24h)" area chart. Gold (#f9bf26) for the primary line.
- Bottom: "Top Rejection Reasons" table with columns: Reason, Count, % — showing "daily cap", "hashcash failed", "geo-blocked".

Colors: page bg #14110c, sidebar #1d1a14, cards #1d1a14 with 1px border #2a2520, active nav item highlighted with #f9bf26 text. Clean, data-dense but not cluttered. Think Linear or Grafana's dark theme.
```

### Prompt 3: Admin Dashboard — Claims table

```
Design a dark-mode data table view for "Claims" in an admin dashboard. Full-width table with:

Header row: ID, Time, Address, Status, Decision, Score, Tx ID, IP.

Sample rows showing different statuses with colored badges:
- "broadcast" (amber badge), "confirmed" (green), "rejected" (red), "timeout" (gray), "expired" (dark red).

Filters above the table: Status dropdown, Decision dropdown, Address search input. Pagination at bottom: "Showing 1-50 of 1,234" with prev/next buttons.

One row is expanded/selected, showing an "Explain" drawer sliding in from the right with a visual breakdown of abuse signals: a horizontal stacked bar showing which layers contributed to the score, with layer names and individual contributions.

Colors: bg #14110c, table rows alternate #1d1a14 / #14110c, hover #252118, borders #2a2520. Accent #f9bf26. Monospace for addresses and tx IDs.
```

### Prompt 4: Playground Landing Page

```
Design a dark-mode developer playground landing page for "Nimiq Simple Faucet". Full-width layout.

Hero section: "Try the Nimiq Faucet" as a large heading, "Claim testnet NIM with any framework — in 3 lines of code" as subtitle. Below: a compact embedded claim form (just an address input and a gold "Claim" button) that works live. Subtle glowing gold border around the form.

Below the hero: "Choose your framework" section with 8 cards in a 4×2 grid:
- TypeScript, React, Vue, Python, Go, Flutter, Capacitor, React Native
Each card has: framework logo (small), a 3-line code preview in monospace (syntax highlighted), and a "Try it →" link.

Footer: links to GitHub, Docs, API Explorer.

Colors: bg gradient from #14110c to #1d1a14, cards #1d1a14 with subtle border, gold accent #f9bf26 for the CTA and highlights. Clean, modern, developer-focused. Think Vercel's homepage or Supabase's docs landing.
```

### Prompt 5: SDK Showcase — Split view

```
Design a dark-mode SDK showcase page with a split layout. Left panel (60%): syntax-highlighted code editor showing a Python claim example:

```python
from nimiq_faucet import FaucetClient

client = FaucetClient("https://playground.nimiq-faucet.dev")
response = client.claim("NQ02 STQX ...")
print(response.tx_id)
```

Top-left: "Python" badge. Top-right: "Copy" button.

Right panel (40%): A result card showing the claim outcome:
- "Claim #xKpV" heading
- Status badge: "confirmed" (green)
- Tx ID: monospace, clickable
- Amount: "1 NIM"
- A "Run ▶" button at the bottom in gold.

Below the result card: a terminal-style log showing the HTTP request/response (dark bg, green text for status codes).

Framework tabs at the very top: TypeScript | React | Vue | Python (active) | Go | Flutter — switching tabs changes the code + result.

Colors: code bg #0d0b08 (darker than card), result card #1d1a14, terminal #0d0b08 with green (#22c55e) status codes. Accent #f9bf26.
```

### Prompt 6: Component Library — Buttons, badges, inputs

```
Design a dark-mode component library sheet showing the design system for a crypto faucet developer tool. Show:

Row 1 — Buttons: Primary (gold #f9bf26, dark text), Secondary (outlined, light text), Danger (red), Ghost (text only). Each in default, hover, and disabled states.

Row 2 — Badges: "broadcast" (amber), "confirmed" (green), "rejected" (red), "challenged" (orange), "timeout" (gray), "expired" (dark red). Pill-shaped, small text.

Row 3 — Form inputs: Text input (empty), Text input (filled, with value "NQ02 STQX..." in monospace), Select dropdown, Toggle switch (on/off).

Row 4 — Cards: Stat card ("42.5 NIM" with up-arrow trend), Info card with title + description, Alert/banner (warning: "Restart required").

All on a dark background (#14110c), with subtle borders (#2a2520), rounded corners (8-12px). System sans-serif font, monospace for crypto values. Clean spacing, 8px grid.
```

---

## 8. Implementation Notes

- **Framework:** Vue 3 + Tailwind 4 (already in use). No component library switch.
- **Syntax highlighting:** Shiki (same engine as VitePress) for static code, Monaco for interactive.
- **Charts:** lightweight — consider `unovis` or `chart.js` with dark theme config.
- **Icons:** Heroicons (already in dashboard) or Lucide.
- **Transitions:** Vue's `<Transition>` component for step animations.
- **Code examples:** stored as markdown files, rendered at build time with Shiki.
