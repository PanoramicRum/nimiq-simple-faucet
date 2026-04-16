import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig } from '@playwright/test';

import { buildApp } from '../../apps/server/src/app.js';
import { ServerConfigSchema } from '../../apps/server/src/config.js';
import { StubDriver } from './fixtures/StubDriver.js';
import {
  ADMIN_PASSWORD,
  ADMIN_TOTP_SECRET,
  HASHCASH_SECRET,
} from './helpers/server.js';

const FAUCET_ADDR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000';

/**
 * Serialised state written to ./.e2e-state.json so the teardown process (a
 * separate Node worker) can find the temp data dir.
 */
interface E2EState {
  baseUrl: string;
  dataDir: string;
  pid: number;
}

function repoRoot(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return resolve(here, '..', '..');
}

function assertBuilt(path: string, hint: string): void {
  if (!existsSync(path)) {
    throw new Error(
      `[e2e] Missing built asset: ${path}\n` +
        `       ${hint}\n` +
        `       run 'pnpm -r build' first`,
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const root = repoRoot();
  const claimDist = resolve(root, 'apps/claim-ui/dist');
  const dashDist = resolve(root, 'apps/dashboard/dist');
  assertBuilt(join(claimDist, 'index.html'), 'claim-ui dist missing');
  assertBuilt(join(dashDist, 'index.html'), 'dashboard dist missing');

  const dataDir = mkdtempSync(join(tmpdir(), 'faucet-e2e-'));

  const config = ServerConfigSchema.parse({
    network: 'test',
    dataDir,
    signerDriver: 'rpc',
    rpcUrl: 'http://unused',
    walletAddress: FAUCET_ADDR,
    claimAmountLuna: '100000',
    rateLimitPerMinute: '10000',
    rateLimitPerIpPerDay: '5',
    hashcashSecret: HASHCASH_SECRET,
    hashcashDifficulty: '8',
    adminPassword: ADMIN_PASSWORD,
    adminTotpSecret: ADMIN_TOTP_SECRET,
    adminLoginRatePerMinute: '1000',
    challengeRatePerMinute: '10000',
    claimUiDir: claimDist,
    dashboardDir: dashDist,
    uiEnabled: 'true',
    dev: 'true',
    corsOrigins: '*',
  });

  const driver = new StubDriver();
  const { app } = await buildApp(config, { driverOverride: driver, quietLogs: true });
  const port = Number(process.env['FAUCET_E2E_PORT'] ?? 34567);
  await app.listen({ port, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${port}`;

  process.env['FAUCET_E2E_BASE_URL'] = baseUrl;

  const state: E2EState = { baseUrl, dataDir, pid: process.pid };
  writeFileSync(resolve(root, '.e2e-state.json'), JSON.stringify(state), 'utf8');

  // Keep references attached to globalThis so teardown (same Node process when
  // Playwright runs the lifecycle inline) can close the server cleanly. When a
  // fresh process runs teardown, it reads the state file and falls back to a
  // best-effort cleanup of the temp dir only.
  (globalThis as unknown as { __faucetE2E?: { app: typeof app; dataDir: string } }).__faucetE2E = {
    app,
    dataDir,
  };
}
