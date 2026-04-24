import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import type { CurrencyDriver } from '@faucet/core';
import type { GeoIpResolver } from '@faucet/abuse-geoip';
import { sql } from 'drizzle-orm';
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
import { registry, driverReady, walletBalance } from './metrics.js';
import { EventRing } from './events.js';

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
  // Fix #87: never trust `X-Forwarded-For` / `X-Real-IP` from arbitrary peers.
  // Trust only the CIDRs an operator has explicitly allow-listed
  // (`FAUCET_TRUSTED_PROXY_CIDRS`). Empty → no upstream proxy is trusted and
  // `req.ip` is the raw socket address. Loopback is added in dev so local
  // e2e tests can exercise XFF paths against `127.0.0.1`.
  const proxyAllowList = [
    ...config.trustedProxyCidrs,
    ...(config.dev ? ['127.0.0.1/32', '::1/128'] : []),
  ];
  const trustProxy: boolean | string[] = proxyAllowList.length > 0 ? proxyAllowList : false;
  const app = Fastify({
    logger: opts.quietLogs
      ? false
      : {
          level: config.dev ? 'debug' : 'info',
          redact: { paths: buildRedactPaths(), censor: '[REDACTED]', remove: false },
        },
    trustProxy,
    bodyLimit: 64 * 1024,
  });

  await applyHardening(app, config);
  await app.register(cors, { origin: config.corsOrigins });
  await app.register(cookie);
  await app.register(websocket);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rateLimitOpts: any = {
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
    allowList: () => false,
  };
  if (config.redisUrl) {
    const ioredis = await import('ioredis');
    // ioredis default export is the Redis class constructor.
    const RedisClass = (ioredis.default ?? ioredis) as unknown as new (url: string) => unknown;
    rateLimitOpts.redis = new RedisClass(config.redisUrl);
  }
  await app.register(rateLimit, rateLimitOpts);

  const db = openDb({ dataDir: config.dataDir, databaseUrl: config.databaseUrl });
  const driver = opts.driverOverride ?? (await buildDriver(config));
  const pipeline = buildPipeline(
    db,
    config,
    driver,
    opts.geoipResolverOverride ? { geoipResolver: opts.geoipResolverOverride } : {},
  );
  const stream = new EventStream();

  const events = new EventRing();
  events.push({ type: 'faucet_started', message: 'Faucet started' });

  const ctx: AppContext = { config, db, driver, pipeline, stream, events };

  const isDriverReady = (): boolean => driver.isReady?.() !== false;

  // Push a one-time event when the driver becomes ready.
  if (!isDriverReady()) {
    const readyPoll = setInterval(() => {
      if (isDriverReady()) {
        events.push({ type: 'driver_ready', message: 'Node connected and synced' });
        clearInterval(readyPoll);
      }
    }, 2000);
    app.addHook('onClose', () => clearInterval(readyPoll));
  } else {
    events.push({ type: 'driver_ready', message: 'Node connected and synced' });
  }

  // 503-gate routes that must wait for the driver to finish initial sync
  // (WASM consensus, RPC network handshake). Other routes — /healthz,
  // /readyz, admin UI assets, /v1/config, /v1/challenge, UIs — serve
  // from t=0 so operators can see "driver syncing" state instead of a
  // connection-refused.
  const driverDependentPaths = new Set<string>([
    '/v1/claim',
    '/admin/account',
    '/admin/account/send',
    '/admin/overview',
  ]);

  app.addHook('preHandler', async (req, reply) => {
    if (isDriverReady()) return;
    const path = req.routeOptions?.url;
    if (path && driverDependentPaths.has(path)) {
      reply.header('Retry-After', '10');
      return reply.code(503).send({
        error: 'driver_not_ready',
        message: 'Signer driver is still establishing consensus. Retry shortly.',
      });
    }
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_req, reply) => {
    const checks: Record<string, string> = {};
    let allOk = true;

    checks.driver = isDriverReady() ? 'ok' : 'not_ready';
    if (checks.driver !== 'ok') allOk = false;

    try {
      db.run(sql`SELECT 1`);
      checks.db = 'ok';
    } catch (err) {
      checks.db = `error: ${(err as Error).message}`;
      allOk = false;
    }

    if (isDriverReady()) {
      try {
        checks.balance = (await driver.getBalance()).toString();
      } catch {
        checks.balance = 'unknown';
      }
    } else {
      checks.balance = 'unknown';
    }

    if (!allOk) {
      reply.header('Retry-After', '10');
      reply.code(503);
    }
    return { ready: allOk, checks };
  });
  app.get('/metrics', async (_req, reply) => {
    if (!config.metricsEnabled) return reply.code(404).send({ error: 'metrics disabled' });
    driverReady.set(isDriverReady() ? 1 : 0);
    try {
      walletBalance.set(Number(await driver.getBalance()));
    } catch {
      // Driver not ready — leave gauge at its last value.
    }
    reply.type(registry.contentType);
    return registry.metrics();
  });
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
