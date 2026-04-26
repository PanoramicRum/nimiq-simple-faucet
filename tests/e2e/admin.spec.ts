import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  ADMIN_PASSWORD,
  ADMIN_TOTP_SECRET,
  TEST_USER_ADDRESS,
  totpCode,
} from './helpers/server.js';

/**
 * Admin-spec ordering matters: first login consumes the one-time provisioning
 * URI, subsequent tests assume the seed happened. Serial mode guarantees the
 * shared Fastify instance sees our tests in order.
 */
test.describe.configure({ mode: 'serial' });

// Reset the admin user + sessions before each browser project so the
// `first login reveals TOTP provisioning URI` test sees a clean slate even
// when multiple projects share the same Fastify instance / SQLite DB.
test.beforeAll(async ({ request }) => {
  const res = await request.post('/admin/auth/reset', {
    data: { password: ADMIN_PASSWORD },
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok()) {
    throw new Error(`admin reset endpoint returned ${res.status()}`);
  }
});

async function doLogin(page: Page, withTotp: boolean): Promise<void> {
  await page.goto('/admin/login');
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  if (withTotp) {
    const code = totpCode(ADMIN_TOTP_SECRET);
    await page.locator('input[autocomplete="one-time-code"]').fill(code);
  }

  // Wait for the login round-trip explicitly. `argon2id verifyPassword`
  // dominates the cost on the second-login path and can take 1–3 s on
  // a contended CI runner; combined with router.replace + Vue mount,
  // the prior 10 s budget on `waitForURL` was tight enough to flake on
  // Firefox specifically (twice — see admin.spec.ts:85 and :159 in
  // recent runs). Awaiting the response in parallel with the click
  // catches login failures with a clear error and bounds the wall-clock
  // budget to a single round-trip plus 20 s for the SPA navigation.
  const [loginResponse] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().endsWith('/admin/auth/login') && res.request().method() === 'POST',
      { timeout: 20_000 },
    ),
    page.locator('button[type="submit"]').click(),
  ]);
  if (loginResponse.status() !== 200) {
    throw new Error(
      `login POST returned ${loginResponse.status()}: ${await loginResponse.text()}`,
    );
  }

  if (withTotp) {
    await page.waitForURL(/\/admin\/overview$/, { timeout: 20_000 });
  } else {
    // First-login flow flips the login view into the enrolment panel.
    await page.getByLabel('TOTP provisioning URI').waitFor({ timeout: 20_000 });
  }
}

async function seedClaim(request: APIRequestContext, address: string): Promise<void> {
  await request.post('/v1/claim', {
    data: { address },
    headers: { 'content-type': 'application/json' },
  });
}

test.describe('admin ui', () => {
  test('wrong password shows an error', async ({ page }) => {
    await page.goto('/admin/login');
    await page.fill('input[type="password"]', 'totally-wrong');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('[role="alert"]')).toBeVisible();
  });

  test('first login reveals TOTP provisioning URI and secret', async ({ page }) => {
    await doLogin(page, /* withTotp */ false);

    // The login view flips into the enrolment panel after a successful seed.
    const uri = page.getByLabel('TOTP provisioning URI');
    await expect(uri).toBeVisible({ timeout: 10_000 });
    const uriValue = await uri.inputValue();
    expect(uriValue).toMatch(/^otpauth:\/\/totp\//);

    const rawSecret = page.getByLabel('TOTP shared secret');
    await expect(rawSecret).toBeVisible();
    const secretValue = await rawSecret.inputValue();
    expect(secretValue).toBe(ADMIN_TOTP_SECRET);

    // "Copy URI" button is present.
    await expect(page.getByRole('button', { name: /Copy URI/ })).toBeVisible();

    // Continue to the dashboard.
    await page.getByRole('button', { name: /continue/i }).click();
    await expect(page).toHaveURL(/\/admin\/overview$/);
  });

  test('second login with password + TOTP lands on overview', async ({ page }) => {
    await doLogin(page, /* withTotp */ true);
    await expect(page).toHaveURL(/\/admin\/overview$/, { timeout: 10_000 });
    await expect(page.locator('nav#sidebar-nav')).toBeVisible();
  });

  test('claims list renders at least one row', async ({ page, request }) => {
    // Seed a claim via the public API so a row always exists in isolation.
    await seedClaim(request, TEST_USER_ADDRESS);

    await doLogin(page, true);
    await page.goto('/admin/claims');
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    await expect(rows).not.toHaveCount(0);
  });

  test('drawer opens and shows the signals panel', async ({ page, request }) => {
    await seedClaim(request, TEST_USER_ADDRESS.replace('1111', '3333'));
    await doLogin(page, true);
    await page.goto('/admin/claims');

    const row = page.locator('table tbody tr').first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    const drawer = page.locator('[role="dialog"][aria-labelledby="drawer-heading"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Signals')).toBeVisible();
    await expect(drawer.locator('pre[aria-label="Claim signal bundle"]')).toBeVisible();
  });

  test('deny a claim flips its status and produces an audit entry', async ({ page, request }) => {
    await seedClaim(request, TEST_USER_ADDRESS.replace('1111', '4444'));
    await doLogin(page, true);
    await page.goto('/admin/claims');

    await page.locator('table tbody tr').first().click();
    const drawer = page.locator('[role="dialog"][aria-labelledby="drawer-heading"]');
    await expect(drawer).toBeVisible();

    await drawer.getByRole('button', { name: /^Deny$/ }).click();
    // Status should reflect a manual override within a couple of seconds.
    await expect(drawer).toContainText(/deny|rejected/i, { timeout: 5_000 });

    await page.goto('/admin/logs');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('table tbody')).toContainText(/claim\.deny|admin\.deny|deny/i, {
      timeout: 2_000,
    });
  });

  test('blocklist: add → appears → remove → gone', async ({ page }) => {
    await doLogin(page, true);
    await page.goto('/admin/abuse');

    const testIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(
      Math.random() * 250,
    )}.${Math.floor(Math.random() * 250)}`;

    // Select kind=ip, enter value, submit.
    await page.locator('select').first().selectOption('ip');
    await page.locator('input[required]').fill(testIp);
    await page.getByRole('button', { name: /^Add/ }).click();

    const row = page.locator('table tbody tr', { hasText: testIp });
    await expect(row).toBeVisible({ timeout: 5_000 });

    await row.getByRole('button', { name: /^Remove$/ }).click();
    await expect(page.locator('table tbody tr', { hasText: testIp })).toHaveCount(0, {
      timeout: 5_000,
    });
  });

  test('logout clears the session and /admin/overview redirects to /admin/login', async ({
    page,
    context,
  }) => {
    await doLogin(page, true);
    await expect(page).toHaveURL(/\/admin\/overview$/);

    // Hit the logout endpoint directly (there's no visible "logout" in the
    // captured markup, but the API exists and is what the dashboard calls).
    const res = await page.request.post('/admin/auth/logout');
    expect(res.ok()).toBeTruthy();

    // Clear the in-memory auth-store cookie state by reloading with no session.
    await context.clearCookies();

    await page.goto('/admin/overview');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
