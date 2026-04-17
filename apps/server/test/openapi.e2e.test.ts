import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS } from './helpers/testDriver.js';

const FAUCET_ADDR = TEST_FAUCET_ADDRESS;

class StubDriver extends BaseTestDriver {}

function makeConfig(tmp: string, overrides: Record<string, unknown> = {}) {
  return ServerConfigSchema.parse({
    network: 'test',
    dataDir: tmp,
    signerDriver: 'rpc',
    rpcUrl: 'http://unused',
    walletAddress: FAUCET_ADDR,
    claimAmountLuna: '100000',
    rateLimitPerIpPerDay: '3',
    adminPassword: 'test-password-123',
    ...overrides,
  });
}

describe('OpenAPI document + docs viewer', () => {
  let tmp: string;
  let devApp: Awaited<ReturnType<typeof buildApp>>['app'];
  let prodApp: Awaited<ReturnType<typeof buildApp>>['app'];

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-openapi-'));
    // Literal booleans — `z.coerce.boolean()` treats any non-empty string as
    // truthy, so we can't pass `'false'` to toggle it off.
    devApp = (
      await buildApp(
        makeConfig(tmp + '/dev', { dev: true, tlsRequired: false, corsOrigins: 'https://example.test' }),
        { driverOverride: new StubDriver(), quietLogs: true },
      )
    ).app;
    prodApp = (
      await buildApp(
        makeConfig(tmp + '/prod', { dev: false, tlsRequired: false, corsOrigins: 'https://example.test' }),
        { driverOverride: new StubDriver(), quietLogs: true },
      )
    ).app;
    await devApp.ready();
    await prodApp.ready();
  });

  afterAll(async () => {
    await devApp.close();
    await prodApp.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('serves /openapi.json with OpenAPI 3.1 and documents core paths', async () => {
    const res = await devApp.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const body = res.json() as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components?: { securitySchemes?: Record<string, unknown> };
    };
    expect(body.openapi).toBe('3.1.0');
    const claimPost = body.paths['/v1/claim']?.post as
      | { requestBody?: { content?: Record<string, { schema?: unknown }> } }
      | undefined;
    expect(claimPost?.requestBody?.content?.['application/json']?.schema).toBeDefined();
    expect(Object.keys(body.paths).length).toBeGreaterThanOrEqual(5);
    expect(body.components?.securitySchemes).toHaveProperty('integratorHmac');
    expect(body.components?.securitySchemes).toHaveProperty('adminSession');
  });

  it('serves the viewer at /docs/api in dev mode', async () => {
    const res = await devApp.inject({ method: 'GET', url: '/docs/api' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toMatch(/elements-api/);
  });

  it('hides /docs/api in production when openapiPublic is false', async () => {
    const res = await prodApp.inject({ method: 'GET', url: '/docs/api' });
    expect(res.statusCode).toBe(404);
  });
});
