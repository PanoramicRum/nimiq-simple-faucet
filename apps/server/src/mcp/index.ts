/**
 * Fastify plugin wiring the MCP server into the faucet app.
 *
 * Exposes:
 *   - `POST /mcp` — streamable HTTP transport (JSON-RPC over HTTP/SSE).
 *   - `GET  /mcp` — lightweight discovery: name, version, tool catalogue.
 *
 * Admin authentication is a stub: reads `x-faucet-admin-token` and compares
 * timing-safely to `FAUCET_ADMIN_MCP_TOKEN`. The real admin-session flow is
 * M3; see `apps/server/src/mcp/server.ts`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppContext } from '../context.js';
import { ALL_TOOLS, ADMIN_TOOLS, buildMcpServer } from './server.js';

/** Header used to pass the stub admin token. */
export const ADMIN_TOKEN_HEADER = 'x-faucet-admin-token';

export async function mcpRoute(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const configuredAdminToken = process.env.FAUCET_ADMIN_MCP_TOKEN;

  app.get('/mcp', async () => ({
    name: 'nimiq-faucet',
    version: '0.0.1',
    transport: 'streamable-http',
    tools: ALL_TOOLS.map((name) => ({
      name,
      admin: ADMIN_TOOLS.has(name),
    })),
  }));

  app.post('/mcp', async (req: FastifyRequest, reply: FastifyReply) => {
    const headerValue = req.headers[ADMIN_TOKEN_HEADER];
    const providedAdminToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    const server = buildMcpServer(ctx, {
      getAdminToken: () => providedAdminToken,
      ...(configuredAdminToken !== undefined ? { configuredAdminToken } : {}),
    });

    // Stateless: one transport per request, no session IDs. The SDK's type
    // signature marks `sessionIdGenerator` as `() => string`, but the runtime
    // treats `undefined` as the stateless sentinel — see the SDK JSDoc.
    const transport = new StreamableHTTPServerTransport(
      { sessionIdGenerator: undefined } as unknown as ConstructorParameters<
        typeof StreamableHTTPServerTransport
      >[0],
    );

    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });

    // Hand the raw socket to the MCP transport. Fastify must not try to
    // serialize a response on top of it.
    reply.hijack();
    // The transport's optional-property variance conflicts with
    // `exactOptionalPropertyTypes` on the SDK's `Transport` interface; the
    // cast is safe because the same SDK package produces both sides.
    await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
}
