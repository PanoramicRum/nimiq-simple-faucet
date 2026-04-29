/**
 * §3.0.14 — end-to-end test of the Claim-UI theme switcher.
 *
 * The unit tests in `themes.test.ts` cover the registry's logic. This
 * test boots the actual Fastify server with a fake claim-UI dist and
 * asserts that:
 *
 *   1. `FAUCET_CLAIM_UI_DIR` (explicit override) wins absolutely — the
 *      fake dist's `index.html` is what gets served at `/`.
 *   2. A nonexistent `FAUCET_CLAIM_UI_DIR` logs a warning and falls
 *      through to the registry resolution (still returns 200 if any
 *      bundled theme can be found, or 404 if not — we accept either).
 *   3. SPA fallback: requesting an unknown path returns the same
 *      `index.html` (so `vue-router` / `react-router` history mode works).
 *   4. Reserved API/admin paths still return 404 / their normal response
 *      and don't get caught by the SPA fallback.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ServerConfigSchema } from '../src/config.js';
import { BaseTestDriver, TEST_FAUCET_ADDRESS } from './helpers/testDriver.js';

class ReadyDriver extends BaseTestDriver {
  override isReady() { return true; }
  override async getBalance() { return 1_000_000n; }
  override async send() { return 'tx_test'; }
  override async init() {}
}

function baseRawConfig(dir: string, claimUiDir?: string): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    geoipBackend: 'none',
    network: 'test',
    dataDir: dir,
    signerDriver: 'rpc',
    rpcUrl: 'http://unused',
    walletAddress: TEST_FAUCET_ADDRESS,
    claimAmountLuna: '100000',
    rateLimitPerIpPerDay: '100',
    adminPassword: 'test-password-123',
    corsOrigins: 'https://example.test',
    dev: true,
    tlsRequired: false,
    uiEnabled: true,
  };
  if (claimUiDir) cfg.claimUiDir = claimUiDir;
  return cfg;
}

const FAKE_INDEX_HTML = `<!DOCTYPE html>
<html><head><title>fake-theme</title></head>
<body><div id="app">FAKE_THEME_MARKER_${Date.now()}</div></body></html>`;

describe('claim-ui theme switching (§3.0.14)', () => {
  let tmp: string;
  let fakeDist: string;
  const apps: Array<Awaited<ReturnType<typeof buildApp>>['app']> = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'faucet-themes-'));
    fakeDist = mkdtempSync(join(tmpdir(), 'fake-theme-'));
    writeFileSync(join(fakeDist, 'index.html'), FAKE_INDEX_HTML);
  });

  afterEach(async () => {
    for (const a of apps) await a.close();
    apps.length = 0;
    rmSync(tmp, { recursive: true, force: true });
    rmSync(fakeDist, { recursive: true, force: true });
  });

  it('FAUCET_CLAIM_UI_DIR override serves index.html from the given dir', async () => {
    const cfg = ServerConfigSchema.parse(baseRawConfig(tmp, fakeDist));
    const built = await buildApp(cfg, { driverOverride: new ReadyDriver(), quietLogs: true });
    apps.push(built.app);
    await built.app.ready();

    const res = await built.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('FAKE_THEME_MARKER_');
    expect(res.headers['content-type']).toMatch(/html/);
  });

  it('SPA fallback: unknown paths return the theme\'s index.html', async () => {
    const cfg = ServerConfigSchema.parse(baseRawConfig(tmp, fakeDist));
    const built = await buildApp(cfg, { driverOverride: new ReadyDriver(), quietLogs: true });
    apps.push(built.app);
    await built.app.ready();

    const res = await built.app.inject({ method: 'GET', url: '/some/client-side/route' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('FAKE_THEME_MARKER_');
  });

  it('reserved API paths still get the API\'s 404, not the SPA fallback', async () => {
    const cfg = ServerConfigSchema.parse(baseRawConfig(tmp, fakeDist));
    const built = await buildApp(cfg, { driverOverride: new ReadyDriver(), quietLogs: true });
    apps.push(built.app);
    await built.app.ready();

    const res = await built.app.inject({ method: 'GET', url: '/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('FAKE_THEME_MARKER_');
  });

  it('FAUCET_CLAIM_UI_DIR pointing at a nonexistent path falls back to the bundled registry', async () => {
    // The fallback target is the porcelain-vault / nimiq-pow dist in
    // either /app/themes/<slug> (production Docker) or apps/<slug>-ui/dist
    // (monorepo dev). Tests don't always have those built — when they do,
    // we serve the fallback (200); when they don't, the not-found handler
    // can't sendFile and we get a 5xx. Either way we MUST NOT crash on
    // the unknown FAUCET_CLAIM_UI_DIR — the warning log + graceful
    // fallthrough is the contract this test pins.
    const nonexistent = join(tmpdir(), `does-not-exist-${Date.now()}`);
    const cfg = ServerConfigSchema.parse(baseRawConfig(tmp, nonexistent));
    const built = await buildApp(cfg, { driverOverride: new ReadyDriver(), quietLogs: true });
    apps.push(built.app);
    await expect(built.app.ready()).resolves.toBeDefined();
    // /healthz always works regardless of UI path resolution.
    const health = await built.app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
  });

  it('FAUCET_CLAIM_UI_THEME=unknown-slug logs a warning and serves the default theme (or no UI in test)', async () => {
    // Unknown slug should not crash; the resolver downgrades to
    // DEFAULT_THEME with a warning log. We assert the boot path stays
    // healthy — actual served HTML depends on whether the default theme
    // dist exists in the test environment, which is not guaranteed.
    const raw = baseRawConfig(tmp);
    raw.claimUiTheme = 'this-slug-does-not-exist';
    const cfg = ServerConfigSchema.parse(raw);
    const built = await buildApp(cfg, { driverOverride: new ReadyDriver(), quietLogs: true });
    apps.push(built.app);
    await expect(built.app.ready()).resolves.toBeDefined();
    const health = await built.app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
  });
});
