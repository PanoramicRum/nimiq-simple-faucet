import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Nimiq Simple Faucet end-to-end suite (milestone M5).
 *
 * The Fastify app-under-test is started programmatically inside `globalSetup`
 * on a fixed port so both the config (loaded once in the parent) and the
 * worker processes agree on the base URL. Override with `FAUCET_E2E_PORT` if
 * the default collides with something else on the host.
 */
const isCI = !!process.env['CI'];
const E2E_PORT = Number(process.env['FAUCET_E2E_PORT'] ?? 34567);
const E2E_BASE_URL = process.env['FAUCET_E2E_BASE_URL'] ?? `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['html', { open: 'never' }], ['list']],
  globalSetup: './tests/e2e/globalSetup.ts',
  globalTeardown: './tests/e2e/globalTeardown.ts',
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
