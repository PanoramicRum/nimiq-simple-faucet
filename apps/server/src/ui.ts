import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { ServerConfig } from './config.js';
import { THEMES, DEFAULT_THEME, isKnownTheme, type ThemeSlug } from './themes.js';

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    if (existsSync(c)) return resolve(c);
  }
  return null;
}

/**
 * Resolve which directory the Claim UI is served from. Order:
 *   1. `config.claimUiDir` — explicit operator override (custom themes
 *      not bundled in the Docker image, dev work, etc.). Wins absolutely.
 *   2. The bundled-theme registry: `config.claimUiTheme` → `THEMES[slug]`.
 *      Tries the production-Docker path first, then the monorepo dev path.
 *   3. The default theme (`porcelain-vault`) — preserves the original
 *      behaviour for anyone who upgrades without setting any new env vars.
 *
 * An unknown `claimUiTheme` value (typo in deployment env) is downgraded
 * to the default with a warning log; we never crash the UI for a bad slug.
 */
function resolveClaimUiDir(
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

  let theme: ThemeSlug;
  if (isKnownTheme(config.claimUiTheme)) {
    theme = config.claimUiTheme;
  } else {
    log.warn(
      { requested: config.claimUiTheme, fallback: DEFAULT_THEME, knownThemes: Object.keys(THEMES) },
      'FAUCET_CLAIM_UI_THEME slug not found in registry; falling back to default theme',
    );
    theme = DEFAULT_THEME;
  }

  const manifest = THEMES[theme];
  const dir = firstExisting([
    manifest.distInImage,
    resolve(process.cwd(), manifest.distFromRepoRoot),
    resolve(process.cwd(), '../', manifest.distFromRepoRoot.replace(/^apps\//, '')),
  ]);
  return { dir, theme };
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

export async function registerUi(app: FastifyInstance, config: ServerConfig): Promise<void> {
  if (!config.uiEnabled) return;

  const dash = dashboardDir(config);
  if (dash) {
    await app.register(fastifyStatic, {
      root: dash,
      prefix: '/admin/',
      decorateReply: false,
      wildcard: false,
    });
    // SPA fallback for /admin/* unknown paths.
    app.get('/admin/*', async (_req, reply) => {
      return reply.sendFile('index.html', dash);
    });
    app.log.info({ dash }, 'dashboard ui mounted at /admin');
  }

  const { dir: claim, theme } = resolveClaimUiDir(config, app.log);
  if (claim) {
    await app.register(fastifyStatic, {
      root: claim,
      prefix: '/',
      decorateReply: true,
      wildcard: false,
    });
    // SPA fallback for any non-API path that isn't a file. We keep the API and
    // admin prefixes reserved; everything else gets the claim-ui shell.
    app.setNotFoundHandler(async (req, reply) => {
      const url = req.url;
      if (
        url.startsWith('/v1/') ||
        url.startsWith('/admin/') ||
        url.startsWith('/mcp') ||
        url === '/healthz' ||
        url === '/llms.txt'
      ) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html', claim);
    });
    app.log.info({ claim, theme }, 'claim ui mounted at /');
  }
}
