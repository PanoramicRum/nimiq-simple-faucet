import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { ServerConfig } from './config.js';

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    if (existsSync(c)) return resolve(c);
  }
  return null;
}

function claimUiDir(config: ServerConfig): string | null {
  if (config.claimUiDir) return existsSync(config.claimUiDir) ? resolve(config.claimUiDir) : null;
  return firstExisting([
    resolve(process.cwd(), 'apps/claim-ui/dist'),
    resolve(process.cwd(), '../claim-ui/dist'),
    '/app/apps/claim-ui/dist',
  ]);
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

  const claim = claimUiDir(config);
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
    app.log.info({ claim }, 'claim ui mounted at /');
  }
}
