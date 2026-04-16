import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import type { CurrencyDriver } from '@faucet/core';
import type { GeoIpResolver } from '@faucet/abuse-geoip';
import type { ServerConfig } from './config.js';
import { openDb } from './db/index.js';
import { buildDriver } from './drivers.js';
import { buildPipeline } from './abuse/pipeline.js';
import { EventStream, streamRoute } from './stream.js';
import { claimRoutes } from './routes/claim.js';
import { adminRoutes } from './routes/admin/index.js';
import { mcpRoute } from './mcp/index.js';
import { openapiRoute } from './openapi/route.js';
import { registerUi } from './ui.js';
import { applyHardening, buildRedactPaths } from './hardening.js';
import type { AppContext } from './context.js';

export interface BuildAppOptions {
  /** Replace the Nimiq driver (useful for tests). */
  driverOverride?: CurrencyDriver;
  /** Plug a custom GeoIP resolver (tests, integrators with in-house feeds). */
  geoipResolverOverride?: GeoIpResolver;
  /** Silence the default Fastify logger. */
  quietLogs?: boolean;
}

export async function buildApp(
  config: ServerConfig,
  opts: BuildAppOptions = {},
): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const app = Fastify({
    logger: opts.quietLogs
      ? false
      : {
          level: config.dev ? 'debug' : 'info',
          redact: { paths: buildRedactPaths(), censor: '[REDACTED]', remove: false },
        },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  await applyHardening(app, config);
  await app.register(cors, { origin: config.corsOrigins });
  await app.register(cookie);
  await app.register(websocket);
  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
    allowList: () => false,
  });

  const db = openDb({ dataDir: config.dataDir, databaseUrl: config.databaseUrl });
  const driver = opts.driverOverride ?? (await buildDriver(config));
  const pipeline = buildPipeline(
    db,
    config,
    driver,
    opts.geoipResolverOverride ? { geoipResolver: opts.geoipResolverOverride } : {},
  );
  const stream = new EventStream();

  const ctx: AppContext = { config, db, driver, pipeline, stream };

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/llms.txt', async (_req, reply) => {
    reply.type('text/plain');
    return [
      '# Nimiq Simple Faucet',
      `network: ${config.network}`,
      'endpoints:',
      '  POST /v1/claim  — submit a claim',
      '  GET  /v1/claim/:id — check status',
      '  GET  /v1/config — limits + captcha site key + enabled abuse layers',
      '  GET  /v1/stats — recent aggregates',
      '  WS   /v1/stream — live claim events',
      '  GET  /openapi.json — full schema',
      'agents: see /AGENTS.md at the repo root',
    ].join('\n');
  });

  await claimRoutes(app, ctx);
  await adminRoutes(app, ctx);
  await streamRoute(app, stream);
  await mcpRoute(app, ctx);
  await openapiRoute(app, ctx);
  await registerUi(app, config);

  return { app, ctx };
}
