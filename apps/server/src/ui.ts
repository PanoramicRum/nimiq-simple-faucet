import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { ServerConfig } from './config.js';
import { THEMES, DEFAULT_THEME, isKnownTheme, type ThemeSlug } from './themes.js';

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    if (existsSync(c)) return resolve(c);
  }
  return null;
}

function dirForTheme(slug: ThemeSlug): string | null {
  const manifest = THEMES[slug];
  return firstExisting([
    manifest.distInImage,
    resolve(process.cwd(), manifest.distFromRepoRoot),
    resolve(process.cwd(), '../', manifest.distFromRepoRoot.replace(/^apps\//, '')),
  ]);
}

/**
 * Pick the active theme from config:
 *   1. `config.claimUiDir` — operator override; returns null slug, caller
 *      uses the explicit dir.
 *   2. `config.claimUiTheme` — registry lookup; falls back to DEFAULT_THEME
 *      with a warning log when the slug is unknown.
 */
function resolveActiveTheme(
  config: ServerConfig,
  log: { warn: (obj: object, msg?: string) => void },
): { dir: string | null; theme: ThemeSlug | null } {
  if (config.claimUiDir) {
    if (existsSync(config.claimUiDir)) {
      return { dir: resolve(config.claimUiDir), theme: null };
    }
    log.warn(
      { claimUiDir: config.claimUiDir },
      'FAUCET_CLAIM_UI_DIR set but path does not exist; falling back to bundled theme',
    );
  }
  const theme: ThemeSlug = isKnownTheme(config.claimUiTheme) ? config.claimUiTheme : DEFAULT_THEME;
  if (!isKnownTheme(config.claimUiTheme)) {
    log.warn(
      { requested: config.claimUiTheme, fallback: DEFAULT_THEME, knownThemes: Object.keys(THEMES) },
      'FAUCET_CLAIM_UI_THEME slug not found in registry; falling back to default theme',
    );
  }
  return { dir: dirForTheme(theme), theme };
}

function dashboardDir(config: ServerConfig): string | null {
  if (config.dashboardDir)
    return existsSync(config.dashboardDir) ? resolve(config.dashboardDir) : null;
  return firstExisting([
    resolve(process.cwd(), 'apps/dashboard/dist'),
    resolve(process.cwd(), '../dashboard/dist'),
    '/app/apps/dashboard/dist',
  ]);
}

/**
 * §3.0.16 — given a request, decide which theme's index.html to serve.
 * Honours the `?theme=<slug>` query when the picker is enabled and the
 * slug is known; otherwise falls back to the env-configured active theme.
 */
function themeForRequest(
  req: FastifyRequest,
  config: ServerConfig,
  active: ThemeSlug,
  themeDirs: Map<ThemeSlug, string>,
): { dir: string; slug: ThemeSlug } {
  if (config.themePickerEnabled) {
    // req.query is parsed by fastify automatically.
    const q = req.query as Record<string, unknown> | null | undefined;
    const requested = typeof q?.theme === 'string' ? q.theme : '';
    if (requested && isKnownTheme(requested)) {
      const dir = themeDirs.get(requested);
      if (dir) return { dir, slug: requested };
    }
  }
  // Falls through to active theme.
  const dir = themeDirs.get(active);
  if (!dir) throw new Error(`active theme "${active}" has no dist directory`);
  return { dir, slug: active };
}

export async function registerUi(app: FastifyInstance, config: ServerConfig): Promise<void> {
  if (!config.uiEnabled) return;

  // Dashboard mounts first at /admin/ — separate from the claim UI's /.
  const dash = dashboardDir(config);
  if (dash) {
    await app.register(fastifyStatic, {
      root: dash,
      prefix: '/admin/',
      decorateReply: false,
      wildcard: false,
    });
    app.get('/admin/*', async (_req, reply) => {
      return reply.sendFile('index.html', dash);
    });
    app.log.info({ dash }, 'dashboard ui mounted at /admin');
  }

  // Resolve the env-configured active theme + dist dir.
  const { dir: activeDir, theme: activeSlug } = resolveActiveTheme(config, app.log);
  if (!activeDir) return;

  // Build a map slug → resolved dist dir for every bundled theme. When
  // the picker is enabled we mount all of them so their hashed assets
  // route correctly; otherwise we mount only the active theme.
  //
  // The override path (claimUiDir set, activeSlug=null) is stored under
  // DEFAULT_THEME's key so the GET / fallback can always find SOME dir
  // to serve. The picker is effectively bypassed in that case (the
  // override dir wins for both query-matched and fallback requests).
  const themeDirs = new Map<ThemeSlug, string>();
  const fallbackSlug: ThemeSlug = activeSlug ?? DEFAULT_THEME;
  themeDirs.set(fallbackSlug, activeDir);
  if (config.themePickerEnabled && activeSlug) {
    for (const slug of Object.keys(THEMES) as ThemeSlug[]) {
      if (themeDirs.has(slug)) continue;
      const dir = dirForTheme(slug);
      if (dir) themeDirs.set(slug, dir);
    }
  }

  // Mount every theme's dist as a static root. We disable `index` so the
  // root path "/" is handled by our own GET '/' below — that's where we
  // resolve `?theme=<slug>` and serve the right index.html. Hashed asset
  // filenames (e.g. /assets/index-<hash>.js) are unique per build, so
  // multi-mounting at prefix '/' doesn't collide.
  let i = 0;
  for (const [slug, dir] of themeDirs.entries()) {
    await app.register(fastifyStatic, {
      root: dir,
      prefix: '/',
      decorateReply: i === 0,
      wildcard: false,
      index: false,
    });
    i += 1;
    app.log.info({ slug, dir }, 'claim ui theme mounted');
  }

  // GET / — serve the right theme's index.html.
  app.get('/', async (req, reply) => {
    const { dir } = themeForRequest(req, config, fallbackSlug, themeDirs);
    return reply.sendFile('index.html', dir);
  });

  // SPA fallback — same logic for any non-API path that didn't match a file.
  app.setNotFoundHandler(async (req, reply) => {
    const url = req.url;
    if (
      url.startsWith('/v1/') ||
      url.startsWith('/admin/') ||
      url.startsWith('/mcp') ||
      url === '/healthz' ||
      url === '/readyz' ||
      url === '/llms.txt'
    ) {
      return reply.code(404).send({ error: 'not found' });
    }
    const { dir } = themeForRequest(req, config, fallbackSlug, themeDirs);
    return reply.sendFile('index.html', dir);
  });
}
