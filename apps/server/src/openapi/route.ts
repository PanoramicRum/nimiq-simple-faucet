/**
 * Serves the OpenAPI document and a tiny HTML viewer.
 *
 * We gate the human-facing viewer behind `config.dev || config.openapiPublic`
 * so production deployments don't silently ship a docs page; `/openapi.json`
 * itself is always public — it's the contract.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { buildOpenapiDocument } from './document.js';

// Stoplight Elements CDN bundle — one <elements-api> element, no build step.
// We pick Elements over Swagger-UI for tag grouping + better 3.1 support.
const DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Nimiq Simple Faucet — API</title>
  <link rel="stylesheet" href="https://unpkg.com/@stoplight/elements/styles.min.css" />
</head>
<body>
  <elements-api apiDescriptionUrl="/openapi.json" router="hash" layout="sidebar"></elements-api>
  <script src="https://unpkg.com/@stoplight/elements/web-components.min.js" defer></script>
</body>
</html>`;

export async function openapiRoute(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Build lazily so tests that boot multiple apps stay cheap.
  let cached: ReturnType<typeof buildOpenapiDocument> | null = null;
  const doc = (): ReturnType<typeof buildOpenapiDocument> => {
    if (!cached) cached = buildOpenapiDocument(ctx.config);
    return cached;
  };

  app.get('/openapi.json', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    return doc();
  });

  app.get('/openapi.yaml', async (_req, reply) => {
    // Minimal YAML emit — we only need top-level scalar/list support.
    const { stringify } = await import('yaml');
    reply.type('application/yaml; charset=utf-8');
    reply.header('cache-control', 'public, max-age=60');
    return stringify(doc());
  });

  app.get('/docs/api', async (_req, reply) => {
    if (!ctx.config.dev && !ctx.config.openapiPublic) {
      return reply.code(404).send({ error: 'not found' });
    }
    reply.type('text/html; charset=utf-8');
    return DOCS_HTML;
  });
}
