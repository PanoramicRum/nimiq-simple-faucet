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
import { buildPipeline, buildGeoipResolver } from './abuse/pipeline.js';
import { migrateBlocklistNormalization } from './abuse/blocklistMigrate.js';
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
  /**
   * Inject a fake Redis client used by the `/readyz` ping check (and only
   * that — rate-limit is left on its in-memory backend regardless). Tests
   * pass this to exercise the readyz Redis path without booting a real
   * Redis or mocking the ioredis module's full RedisStore surface.
   */
  redisOverride?: { ping: () => Promise<unknown> };
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
  // Hoisted so the /readyz handler can also ping it. Single shared
  // instance avoids a separate connection per request. Tests can inject
  // a fake via `opts.redisOverride` — that path skips the rate-limit
  // wiring (rate-limit stays in-memory) so the test only exercises the
  // readyz ping surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let redisClient: any = null;
  if (opts.redisOverride) {
    redisClient = opts.redisOverride;
  } else if (config.redisUrl) {
    const ioredis = await import('ioredis');
    // ioredis default export is the Redis class constructor.
    const RedisClass = (ioredis.default ?? ioredis) as unknown as new (url: string) => unknown;
    redisClient = new RedisClass(config.redisUrl);
    // Close the client on app teardown so tests + graceful shutdown
    // don't leak the connection.
    app.addHook('onClose', async () => {
      try {
        await redisClient?.quit?.();
      } catch {
        /* best-effort */
      }
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rateLimitOpts: any = {
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
    allowList: () => false,
  };
  // Wire the real ioredis client to rate-limit only when we instantiated
  // it ourselves (i.e. not the test-injected override). The override
  // doesn't speak the rate-limit Lua-script protocol; keeping rate-limit
  // in-memory in tests is fine.
  if (redisClient && !opts.redisOverride) rateLimitOpts.redis = redisClient;
  await app.register(rateLimit, rateLimitOpts);

  const db = openDb({ dataDir: config.dataDir, databaseUrl: config.databaseUrl });
  // One-shot canonicalise of any pre-#94 blocklist rows (idempotent).
  const migrate = await migrateBlocklistNormalization(db);
  if (migrate.updated > 0) {
    app.log.info(
      { inspected: migrate.inspected, updated: migrate.updated },
      'blocklist values renormalised on boot',
    );
  }
  const driver = opts.driverOverride ?? (await buildDriver(config));
  // Build the GeoIP resolver once at boot so /readyz can surface its
  // staleness — see audit Improvement (Tranche 5). Pass the same
  // instance into the pipeline rather than letting it build a separate
  // one, otherwise we'd double the in-memory MMDB cost.
  const geoipResolver: GeoIpResolver | undefined =
    opts.geoipResolverOverride ?? buildGeoipResolver(config);
  const pipeline = buildPipeline(
    db,
    config,
    driver,
    geoipResolver ? { geoipResolver } : {},
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

    // §1.1.2a — Redis PING when configured. Single-instance deployments
    // (REDIS_URL unset → in-memory rate-limit) skip the check, preserving
    // the original behaviour. Wrap in a 1 s timeout so a wedged Redis
    // doesn't slow the probe down.
    if (redisClient) {
      try {
        const pingPromise: Promise<unknown> = redisClient.ping();
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('redis ping timeout (1s)')), 1_000),
        );
        await Promise.race([pingPromise, timeout]);
        checks.redis = 'ok';
      } catch (err) {
        checks.redis = `error: ${(err as Error).message}`;
        allOk = false;
      }
    } else {
      checks.redis = 'not_configured';
    }

    // §1.1.2a — wallet-balance threshold. When `minBalanceLuna` is set,
    // a balance below it flips readyz to 503 so Kubernetes stops routing
    // traffic to a faucet that's about to run dry. When unset, the
    // balance is reported informationally and never fails the probe
    // (matches the original §1.0 behaviour, keeping smoke tests green).
    if (isDriverReady()) {
      try {
        const balance = await driver.getBalance();
        const balanceStr = balance.toString();
        if (config.minBalanceLuna !== undefined && balance < config.minBalanceLuna) {
          checks.balance = `${balanceStr} (below FAUCET_MIN_BALANCE_LUNA=${config.minBalanceLuna.toString()})`;
          allOk = false;
        } else {
          checks.balance = balanceStr;
        }
      } catch {
        checks.balance = 'unknown';
      }
    } else {
      checks.balance = 'unknown';
    }

    // Audit Improvement (Tranche 5): surface GeoIP DB staleness so a
    // forgotten MaxMind / DB-IP refresh shows up as a degraded readyz
    // signal instead of silently mis-classifying VPN/hosting traffic.
    // Stale data does NOT flip readyz to 503 — that would cause Kubernetes
    // to stop routing traffic to a faucet that's still functional, just
    // with degraded geo accuracy. Operators wire the `checks.geoip` field
    // into their alerting if they want a louder signal.
    if (geoipResolver?.healthSnapshot) {
      const snap = geoipResolver.healthSnapshot();
      if (snap) {
        const ageDays =
          snap.ageMs != null ? Math.floor(snap.ageMs / (24 * 60 * 60 * 1_000)) : null;
        checks.geoip = snap.stale
          ? `stale (${snap.resolver}, ${ageDays}d old)`
          : ageDays != null
            ? `ok (${snap.resolver}, ${ageDays}d old)`
            : `ok (${snap.resolver})`;
      }
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
