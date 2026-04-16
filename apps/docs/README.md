# apps/docs

VitePress site for the Nimiq Simple Faucet.

## Run

```bash
pnpm --filter @nimiq-faucet/docs dev
```

Opens a dev server on <http://localhost:5173>.

## Build

```bash
pnpm --filter @nimiq-faucet/docs build
```

Outputs a static site to `apps/docs/dist/` (configured via
`outDir: '../dist'` in `.vitepress/config.mts`).

## Preview the production build

```bash
pnpm --filter @nimiq-faucet/docs preview
```

## Assets served from `public/`

- `public/llms.txt` → `/llms.txt` (authoritative; do not regenerate from this
  app).
- `public/llms-full.txt` → `/llms-full.txt` (authoritative).
- `public/robots.txt` → `/robots.txt`.

## Structure

- `.vitepress/config.mts` — site config (nav, sidebar, markdown options).
- `.vitepress/theme/index.ts` — minimal `DefaultTheme` extension.
- `guide/` — user-facing setup guide.
- `integrations/` — per-SDK recipes.
- `api/` — REST reference.
- `mcp/` — agent integration.
- `security/` — hardening + links to the threat model.
- `changelog.md` — populated by changesets at release (M9).
