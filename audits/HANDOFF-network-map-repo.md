# Handoff — `faucet-map` (new repo)

**Audience**: an autonomous coding agent starting a fresh session in a new git repo. You have no shared context with the originating session. This document is self-contained.

**Date prepared**: 2026-05-04
**Originating repo**: `github.com/PanoramicRum/nimiq-simple-faucet` (the Nimiq faucet — a self-hosted testnet payout service)
**Intended new repo name**: `faucet-map`. Published as the npm package `faucet-map`.

---

## 1. One-line summary

Build a reusable Vue 3 component package that renders a hex-dotted world map with live pulses driven by an event stream. Each pulse marks a recent claim (green) or rejection (amber) at the originating country's centroid, anonymized.

## 2. Why this is split off

The originating faucet repo already ships a Vue 3 themeable claim UI ("Nimiq PoW theme") that wants to embed this map. The map component is reusable beyond the faucet — any Nimiq-network observability UI could mount it — so it lives in its own repo and ships as an npm package. The faucet repo will consume it as a workspace dependency or a published version.

## 3. Scope

**In scope for this new repo**:
- A Vue 3 SFC package: `<NetworkMap />`
- A static hex-dotted world map (procedurally generated from public-domain GeoJSON; do **not** vendor any other project's map asset — see §6)
- Pulse animation primitive (radial expand + alpha fade)
- A small TypeScript event-bridge: takes an SSE/EventSource URL or an `events: Event[]` prop, dispatches to pulse animations
- Storybook or a tiny demo Vite app at `examples/demo/` showing the component in isolation with mock events
- Build → publish to npm as `faucet-map` (final; do not rename without consulting the maintainer)

**Out of scope for this new repo**:
- The faucet itself — that lives in the originating repo
- Real-time peer connection lines (P2P traffic visualization) — the originating use case is claim/reject events
- Heatmaps or aggregate views — pulse-only for v1
- Server-side event emission — the source-of-events SSE endpoint is implemented in the consuming app (faucet, in this case)
- Geo-IP lookup — the consumer has already done that; events arrive with country + jittered centroid coords
- Authentication / rate-limit on the event stream — consumer's responsibility

## 4. Architecture

The component is a **dumb renderer**. The smart half (geo lookup, anonymization, retention buffer, SSE protocol) lives in the consumer (faucet server). This separation is intentional: the map can serve any consumer that emits the event shape below.

```
┌────────────────────────────────────────────┐
│ Consumer (e.g. nimiq-simple-faucet/server) │
│                                            │
│  /v1/events/geo (SSE)                      │
│  emits anonymized {type, country, lat,     │
│                    lng, ts} events         │
└────────────────────┬───────────────────────┘
                     │ EventSource over HTTP
                     ▼
┌────────────────────────────────────────────┐
│  faucet-map  (THIS REPO)                   │
│                                            │
│  <NetworkMap                               │
│    src="..." | :events="..."               │
│    :variant="'default'|'live'"             │
│  />                                        │
│                                            │
│  Renders: hex-dot countries (static) +     │
│           per-event pulse animations       │
└────────────────────────────────────────────┘
```

## 5. Component public API (contract — please honour)

```ts
type NetworkMapEvent = {
  type: 'claim' | 'reject';     // colour = green | amber respectively
  country: string;              // ISO 3166-1 alpha-2, e.g. 'US', 'JP'
  lat: number;                  // already-jittered centroid (~50km noise added by emitter)
  lng: number;                  // same
  timestamp: number;            // ms since epoch
};

type Props = {
  // Either provide an SSE URL...
  src?: string;
  // ...or push events directly (for tests, batched replays, manual control)
  events?: NetworkMapEvent[];
  // Visual variant; v1 ships 'default'. Others can come later.
  variant?: 'default';
  // Max simultaneous pulses on screen; older pulses get culled. Default 50.
  maxConcurrentPulses?: number;
  // Pulse duration in ms. Default 1400.
  pulseDurationMs?: number;
};

type Emits = {
  // Fires when a pulse mounts (useful for sound effects on the consumer side)
  pulse: [event: NetworkMapEvent];
};
```

The component handles its own EventSource lifecycle when `src` is set. When `events` is provided as a prop, it observes mutations and animates each new entry. The two are mutually exclusive — providing both is a runtime warning, `src` wins.

## 6. Visual reference + IP-safety

The originating session's design reference is the Nimiq wallet's network-tab map, visible in `github.com/nimiq/wallet`. **Do not vendor** that asset (its licence relative to the rest of the repo isn't obvious; the SVG and the surrounding code may have different terms).

Recreate the visual instead:

- Source for country geometry: a public-domain dataset, e.g. **Natural Earth's `ne_110m_admin_0_countries`** (CC0). Pull the GeoJSON at build time.
- Tessellate to a hex grid: project to equirectangular, sample on a fixed hex spacing (e.g., 1.5° lat/lng), keep cells whose centroid falls inside a country polygon. Result: deterministic per-build set of `{x, y, country}` records.
- Render: SVG `<circle>` per cell, or canvas with cached path. SVG is simpler and crisp at any zoom; canvas wins if pulse count gets high. Either is fine for v1; benchmark before deciding.
- Pulse animation: at the cell nearest to event's `(lat, lng)`, render an expanding ring (CSS keyframe on the SVG element, or a per-pulse `<circle>` that animates via `<animate>` or programmatic transitions). Colour from theme tokens.
- Theme tokens: expose CSS custom properties that consumers override:
  - `--nm-bg` (default `#1F2348` Nimiq navy)
  - `--nm-dot` (default a low-saturation muted)
  - `--nm-pulse-claim` (default green, e.g. `#6FCF97`)
  - `--nm-pulse-reject` (default amber, e.g. `#F2C94C`)

## 7. Privacy / threat model the consumer must satisfy (informational)

The originating consumer (faucet) must — and the faucet maintainer has agreed it will — emit events with these properties before they hit the SSE stream this map consumes:

- **No IP** in the event payload
- **No precise geolocation** — only the country/region centroid + ~50km random jitter
- **No abuse-layer attribution** — type is just `claim | reject`, no `reason`, no `decision` (reflects the faucet's existing "Public-API silence on rejection" contract from its `SECURITY.md`)
- **No address or txId** — the map is decorative; if the consumer wants click-through to a tx, they layer that on themselves via the `pulse` emit event
- **Operator opt-out** — an env var on the consumer disables the geo stream entirely

The map repo doesn't enforce any of this — it trusts what the consumer emits — but flagging the contract in this handoff so the receiving agent doesn't accidentally widen it. If the agent wants to add **client-side** redaction (e.g., refusing to render an event that has unexpected fields), that's defensive and welcome.

## 8. Pre-decided defaults (carry forward to the new repo unless told otherwise)

| Decision | Default |
|---|---|
| Geo granularity | Country only (no admin-1 region) |
| Reject pulse colour | Amber (`#F2C94C`-ish), not red |
| Public live feed by default | Yes, but consumer must have an opt-out env var |
| Map source | Recreate from Natural Earth public-domain GeoJSON |
| Retention buffer (consumer-side) | ~100 events |
| Component is publishable as | `faucet-map` |

## 9. Suggested initial milestones for the new repo

1. **M1 — Static map renders**: hex grid generated from Natural Earth, rendered as SVG dots on dark navy. No animations. Demo at `examples/demo/`.
2. **M2 — Pulse primitive**: a `triggerPulse({lat, lng, type})` test method renders a single animation. Confirm it lands at the right cell + fades correctly.
3. **M3 — Event-driven**: `events` prop wired; pushing entries fires pulses. Concurrency cap honoured.
4. **M4 — SSE wired**: `src` prop opens an EventSource and processes the same shape. Reconnect-on-error baseline.
5. **M5 — Theming + a11y**: CSS custom properties exposed, `prefers-reduced-motion` disables pulses, `aria-label` describes the map.
6. **M6 — Publish v0.1.0** to npm. Tag in git. Write README with the API table from §5.

Each milestone is a self-contained PR. Don't bundle.

## 10. Integration back into the faucet repo

After M6 ships, the faucet repo will:

1. Add `faucet-map` as a dep in `apps/nimiq-pow-ui/package.json`.
2. Implement the **server-side** `/v1/events/geo` SSE endpoint per §7.
3. Replace `apps/nimiq-pow-ui/src/components/WorldMap.vue` (the existing canvas tribute) with `<NetworkMap src="/v1/events/geo" />`.

That work happens in the faucet repo and is **not** the new repo's responsibility. This handoff is the contract between the two.

## 11. Stack the new repo should use (recommended, not mandatory)

- **Language**: TypeScript (strict)
- **UI framework**: Vue 3 (the originating consumer is Vue 3; if the agent wants framework-agnostic Web Components, fine, but Vue 3 is the path of least friction)
- **Bundler**: Vite (matches the originating ecosystem)
- **Tests**: Vitest + a basic happy-dom for component tests
- **Lint/format**: ESLint (flat config) + Prettier
- **CI**: GitHub Actions; pin actions to commit SHAs (faucet repo does this; copy the pattern). Run typecheck + build + test on every PR.
- **Publish**: npm via OIDC (matches faucet repo's release flow)

## 12. Things the receiving agent should NOT do

- **Don't copy code or assets** from `nimiq/wallet`, `nimiq/web-miner`, or any other Nimiq repo. Recreate from scratch using public-domain data sources.
- **Don't bundle a GeoIP database** — the map doesn't do lookups, it renders precomputed centroids passed in by the consumer.
- **Don't add WebSocket support** — SSE is simpler, fits the consumer's existing `/v1/events` shape, and works through plain HTTP infra.
- **Don't implement event-emission logic** — that's the consumer's job. This package is a renderer.
- **Don't gold-plate v1**: skip zoom/pan, country tooltips, click-through, regional drilldown. They're reasonable v0.2 features; v0.1 is "static map + pulses + done".

## 13. Communication channel back to this repo

The originating faucet maintainer is `PanoramicRum` / `richy@nimiq.com`. When v0.1 is published, ping there. The faucet repo's integration PR will reference the new repo's release tag.

---

**End of handoff. Self-contained — no follow-up questions back to the originating session expected.**
