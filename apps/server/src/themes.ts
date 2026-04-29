/**
 * Registry of bundled Claim UI themes.
 *
 * Each theme is an independently-built Vite/static SPA in `apps/<slug>-ui/`
 * that consumes the public faucet API (`/v1/config`, `/v1/claim`, etc.).
 * The Docker image bundles every theme's `dist/` and an operator picks
 * one at runtime via `FAUCET_CLAIM_UI_THEME=<slug>` — no rebuild.
 *
 * Adding a new theme is a 3-line PR here plus the new app's workspace
 * package. See `docs/contributing-a-frontend.md` for the full contract.
 */

export interface ThemeManifest {
  /** Human-readable name shown in logs and `/v1/config.ui.displayName`. */
  displayName: string;
  /** One-sentence description for docs / future UI picker. */
  description: string;
  /**
   * Path to the built `dist/` directory **relative to the repo root**.
   * Used in dev / monorepo runs (when the server is started via
   * `pnpm --filter @faucet/server start` from the repo root).
   */
  distFromRepoRoot: string;
  /**
   * Absolute path inside the production Docker image. The Dockerfile
   * COPYs each theme's `dist/` to `/app/themes/<slug>/dist/` so a
   * single image can serve any bundled theme by env-var flip.
   */
  distInImage: string;
}

export const THEMES = {
  'porcelain-vault': {
    displayName: 'Porcelain Vault',
    description:
      'The default — clean, off-white, Material 3 palette. Vue 3 + Tailwind. Shipped in v2.2.1.',
    distFromRepoRoot: 'apps/claim-ui/dist',
    distInImage: '/app/themes/porcelain-vault/dist',
  },
} as const satisfies Record<string, ThemeManifest>;

export type ThemeSlug = keyof typeof THEMES;

export const DEFAULT_THEME: ThemeSlug = 'porcelain-vault';

/**
 * Type guard: is the given string a slug we know about? Tolerates
 * unknown env input gracefully — callers fall back to DEFAULT_THEME
 * with a warning log instead of crashing the server.
 */
export function isKnownTheme(slug: string): slug is ThemeSlug {
  return slug in THEMES;
}

export function listThemes(): { slug: ThemeSlug; manifest: ThemeManifest }[] {
  return (Object.keys(THEMES) as ThemeSlug[]).map((slug) => ({
    slug,
    manifest: THEMES[slug],
  }));
}
