# Nimiq Simple Faucet — Design Brief v2 (Maneki-Neko)

## Concept: Lucky Cat Faucet

A **maneki-neko** (lucky cat) is the perfect mascot for a crypto faucet — it beckons fortune. The cat is rendered in Nimiq's light gray/neutral tones, wearing a golden Nimiq collar, with red accents on the ear tips and the traditional coin/bell. The aesthetic is **minimal, geometric, and professional** — think Japanese design meets developer tools. Not cute-sy; more like a refined brand mark.

**Visual references:** Notion's minimal illustrations, Stripe's clean product pages, Japanese minimalism (muji-style whitespace), the Nimiq hexagon's geometric precision.

---

## 1. Nimiq Official Color System

Colors from [Nimiq CSS](https://onmax.github.io/nimiq-ui/nimiq-css/palette.html) (oklch-native, converted to approx hex for Stitch):

### Core brand

| Name | Approx Hex | oklch | Usage |
|------|-----------|-------|-------|
| **Nimiq Dark Blue** | `#1F2348` | `oklch(0.2737 0.068 276.29)` | Dark theme background, sidebar |
| **Nimiq Blue** | `#1F6DCC` | `oklch(0.5849 0.1438 244.29)` | Links, interactive elements |
| **Nimiq Gold** | `#E9B213` | `oklch(0.7924 0.1593 85.61)` | Primary accent — CTA, highlights, the golden collar |
| **Nimiq Red** | `#D94432` | `oklch(0.598 0.1886 30.3)` | Red accents — maneki-neko ears, alerts, error states |
| **Nimiq Green** | `#21BCA5` | `oklch(0.6932 0.1245 178.48)` | Success states, confirmed |
| **White** | `#FFFFFF` | `oklch(1 0 90)` | Light theme background |

### Neutral scale (the maneki-neko body palette)

| Shade | Light mode | Dark mode | Usage |
|-------|-----------|-----------|-------|
| 0 | `#FFFFFF` | `#1F2348` | Page bg |
| 50 | `#FAF9F7` | `#1C1E3A` | Elevated surface |
| 100 | `#F2F0EB` | `#1E2040` | Card bg (light) |
| 200 | `#E9E6E0` | `#222450` | Borders, dividers |
| 300 | `#DEDAD2` | `#262856` | Muted text bg |
| 400 | `#CCC8BE` | `#2D2F60` | Disabled states |
| 500 | `#ADA9A0` | `#40426E` | Placeholder text |
| 600 | `#96918A` | `#505280` | Muted text |
| 700 | `#6B665E` | `#7A7CA0` | Secondary text |
| 800 | `#555049` | `#9598B4` | Body text (dark bg) |
| 900 | `#3A362F` | `#C5C7D8` | Body text (light bg) |

### Semantic

| State | Color | Usage |
|-------|-------|-------|
| Success | Nimiq Green `#21BCA5` | Confirmed claims, valid addresses |
| Error | Nimiq Red `#D94432` | Rejected, failed, invalid |
| Warning | Nimiq Gold `#E9B213` | Broadcast/pending, attention |
| Info | Nimiq Blue `#1F6DCC` | Links, interactive, neutral info |

---

## 2. The Maneki-Neko Mark

The faucet's visual identity is built around a **minimal geometric maneki-neko** that uses exclusively Nimiq brand colors:

- **Body/face:** Nimiq neutral-200 (`#E9E6E0`) to neutral-300 (`#DEDAD2`) — the light gray that reads as porcelain/ceramic
- **Collar:** Nimiq Gold (`#E9B213`) — a thin band around the neck, the most prominent color accent
- **Bell/coin:** Nimiq Gold, hanging from the collar
- **Inner ears, nose, paw pads:** Nimiq Red (`#D94432`) — small, subtle accents
- **Eyes:** Nimiq Dark Blue (`#1F2348`) — tiny, geometric (two dots or half-circles)
- **Raised paw:** one paw up (beckoning), the classic pose

**Style:** flat/2D, geometric shapes (circles, rounded rectangles), no outlines or strokes — just filled shapes. Think: a logo mark, not an illustration. Should work at 24×24px (favicon) and 200×200px (hero).

**Variations:**
- Full body (hero, about page)
- Head only (favicon, small contexts)
- Paw only (loading spinner — waving paw animation)

---

## 3. Typography

| Role | Font | Fallback |
|------|------|----------|
| Headings | **Mulish** (Nimiq's brand font) | system sans-serif |
| Body | Mulish | system sans-serif |
| Code / mono | Fira Code | JetBrains Mono, monospace |
| Addresses | Fira Code | monospace, letter-spacing: 0.05em |

---

## 4. Layout Principles

- **Light theme is primary** for the public-facing playground (approachable, friendly — matches the maneki-neko's welcoming nature)
- **Dark theme** for the admin dashboard (professional, data-dense)
- Both themes use the same component library; only surface + text colors swap via CSS custom properties
- **Max content width:** 1200px centered, generous padding (32px sides)
- **Card corner radius:** 16px (large, warm, matches the cat's roundness)
- **Grid:** 8px base unit

---

## 5. Stitch Prompts v2

### Prompt 1: Maneki-Neko Logo Mark

```
Design a minimal, geometric maneki-neko (Japanese lucky cat) logo mark for a crypto developer tool called "Nimiq Faucet". The cat should be:

- Flat 2D, no outlines — only filled geometric shapes (circles, rounded rectangles)
- Body color: light warm gray (#E9E6E0)
- A thin collar around the neck: gold (#E9B213) with a small circular bell
- Inner ears and nose: red (#D94432), very small accents
- Eyes: two small dark blue (#1F2348) dots
- One paw raised (left paw up, beckoning pose)
- Sitting position, frontal view, symmetrical except for the raised paw

Style: professional and refined, NOT cute/kawaii. Think: a brand mark that works as a favicon (24px) and as a hero illustration (200px). Similar minimalism to Notion's illustrations or Apple's emoji design language. White or transparent background.

Show 3 variations: full body, head only (for favicon), and just the raised paw (for a loading icon).
```

### Prompt 2: Claim UI — Light theme with maneki-neko

```
Design a light-theme faucet claim page for "Nimiq Faucet". Centered layout, max 520px wide.

At the top: a small maneki-neko illustration (the geometric lucky cat in light gray #E9E6E0 with gold collar #E9B213 and red ear accents #D94432). Below it: "Nimiq Faucet" in Mulish font, semibold.

The page has a 4-step claim flow shown as a single card with a step indicator (4 circles at top, active = gold #E9B213, inactive = gray #CCC8BE).

Step 1 (active): "Enter your Nimiq address" — large monospace input (Fira Code), a "Testnet" badge in blue (#1F6DCC), and a gold "Claim 1 NIM" button with rounded corners (8px).

Background: white (#FFFFFF) with a subtle warm gray card (#FAF9F7) and light border (#E9E6E0). Text: dark (#3A362F). Card border-radius: 16px. Clean, spacious, Japanese-minimal aesthetic. Generous whitespace. Think Notion or Linear's light theme but warmer.
```

### Prompt 3: Claim UI — Dark theme (admin context)

```
Same claim card as above but on a dark blue background (#1F2348). The card background is a slightly lighter dark blue (#222450) with a subtle border (#2D2F60).

The maneki-neko logo at the top is the same but now the body reads as a gentle contrast against the dark background. The gold collar and red accents pop more.

Text: light (#C5C7D8 for body, #FFFFFF for headings). Gold (#E9B213) button. Blue (#1F6DCC) links. Green (#21BCA5) for success states.

Step 4 (success state): green checkmark icon, "1 NIM sent!" heading, transaction hash in Fira Code monospace, and a ghost "Claim another" button. Subtle green glow behind the checkmark.
```

### Prompt 4: Admin Dashboard — Dark blue theme

```
Design a dark-theme admin dashboard for "Nimiq Faucet". Background: dark blue (#1F2348).

Left sidebar (240px): darker blue (#1A1D3E), with the maneki-neko head logo at top. Nav items: Overview (active — gold #E9B213 text), Claims, Blocklist, Integrators, Config, Account, Logs. Each with a small icon.

Main content — Overview page:
- 4 stat cards in a row: "Balance: 42.5 NIM", "Claims/hr: 12", "Success: 94%", "Driver: Ready" (green dot). Cards: #222450 bg, #2D2F60 border, 16px radius.
- 2 charts: "Claim Rate (24h)" line chart (gold line on dark), "Latency p95" area chart (blue fill). Chart grid lines: very subtle (#2D2F60).
- "Top Rejections" table below.

Accent: gold #E9B213 for primary actions, blue #1F6DCC for links, green #21BCA5 for success, red #D94432 for errors. Warm but professional. Think Linear's dark theme.
```

### Prompt 5: Playground Landing — Light theme

```
Design a light-theme developer playground landing page for "Nimiq Faucet".

Hero section (white bg #FFFFFF):
- Large maneki-neko illustration (centered, ~120px, the geometric lucky cat with gold collar and red accents)
- Below: "Nimiq Faucet Playground" in large Mulish bold, dark text (#3A362F)
- Subtitle: "Claim testnet NIM with any framework — in 3 lines of code" in gray (#6B665E)
- Embedded compact claim form: address input + gold "Claim" button, with a subtle gold (#E9B213) glowing border

"Choose your framework" section (warm gray bg #FAF9F7):
- 8 cards in a 4×2 grid: TypeScript, React, Vue, Python, Go, Flutter, Capacitor, React Native
- Each card: white bg, 16px radius, subtle border (#E9E6E0), framework logo (small), 3-line code snippet in Fira Code, "Try it →" link in blue (#1F6DCC)

Footer: dark blue (#1F2348) bg with white text, links to GitHub, Docs, API Explorer. Small maneki-neko paw icon.

Overall: clean, spacious, warm. The maneki-neko ties everything together as the welcoming brand element. Japanese-minimal meets developer-tool precision.
```

### Prompt 6: SDK Showcase — Split view

```
Design a light-theme SDK showcase page with a split layout for "Nimiq Faucet Playground".

Framework tabs at top: TypeScript | React | Vue | Python (active, gold underline #E9B213) | Go | Flutter

Left panel (60%, warm gray bg #FAF9F7): syntax-highlighted Python code in Fira Code:

from nimiq_faucet import FaucetClient
client = FaucetClient("https://playground.nimiq-faucet.dev")
response = client.claim("NQ02 STQX ...")

Top-left: "Python" badge (blue #1F6DCC). Top-right: "Copy" icon button.

Right panel (40%, white bg): A result card showing:
- Small maneki-neko paw icon (gold) + "Claim #xKpV"
- Status badge: "confirmed" (green #21BCA5 pill)
- Tx ID: Fira Code monospace, clickable (blue)
- Amount: "1 NIM"
- Gold "Run ▶" button at bottom

Below the result: terminal-style log panel (dark blue #1F2348 bg, green #21BCA5 for "200 OK", gold for headers). Shows the HTTP request/response.

Card radius: 16px. Border: #E9E6E0. Clean, professional, welcoming.
```

### Prompt 7: Component Library Sheet

```
Design a component library sheet for "Nimiq Faucet" design system. Light theme, white background.

Row 1 — Buttons: Primary (gold #E9B213 bg, dark blue #1F2348 text), Secondary (white bg, gray border #CCC8BE, dark text), Danger (red #D94432 bg, white text), Ghost (no bg, blue #1F6DCC text). Default + hover + disabled states. Rounded corners (8px).

Row 2 — Status badges (pill shape): "broadcast" (gold #E9B213), "confirmed" (green #21BCA5), "rejected" (red #D94432), "challenged" (blue #1F6DCC), "timeout" (gray #96918A), "expired" (dark red, muted). Small text, light bg tint + colored text.

Row 3 — Inputs: Text input (empty, gray border), Text input (filled, "NQ02 STQX..." in Fira Code), Select dropdown, Toggle switch (gold when on). Labels in gray above.

Row 4 — Cards: Stat card ("42.5 NIM" large, up-arrow in green), Maneki-neko info card (cat illustration + "Welcome to Nimiq Faucet"), Warning banner (gold bg tint, "Restart required" text).

Row 5 — Dark theme variants of rows 1-4 on dark blue #1F2348 background.

Clean 8px grid. Mulish for text, Fira Code for mono. Warm, professional, Japanese-minimal.
```

---

## 6. Motion & Animation

- **Maneki-neko paw wave:** the loading animation — the raised paw gently waves (rotate -10° to +10°, 600ms ease-in-out loop). Used for page loads, pending states.
- **Step transitions:** slide-left/right, 200ms, ease-out
- **Success:** the maneki-neko's bell/coin briefly glows gold + a subtle confetti of gold coins
- **Status badge:** fade-in + subtle scale (1.05→1.0), 150ms
- **Theme transition:** background/text colors cross-fade, 300ms

---

## 7. Implementation Notes

- **Nimiq CSS:** use `@nimiq/css` UnoCSS preset or the Tailwind plugin for official tokens. This gives us the oklch-native color system + dark/light theme support out of the box.
- **Maneki-neko SVG:** create as an inline SVG component so colors can be themed via CSS custom properties. Ship the 3 variations (full, head, paw) as Vue components.
- **Font:** load Mulish from Google Fonts (already used by Nimiq). Fira Code for monospace.
- **Charts:** lightweight — `chart.js` or `unovis` with Nimiq dark blue theme.
- **Code blocks:** Shiki with a custom Nimiq theme (dark blue bg, gold keywords, green strings, red errors).
