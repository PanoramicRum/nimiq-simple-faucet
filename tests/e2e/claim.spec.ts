import { expect, test, type Page } from '@playwright/test';
import { solveChallenge, type HashcashChallenge } from '@faucet/abuse-hashcash';
import { TEST_USER_ADDRESS } from './helpers/server.js';

const VALID_ADDRESS = TEST_USER_ADDRESS;
const ANOTHER_ADDRESS = 'NQ00 2222 2222 2222 2222 2222 2222 2222 2222';

// Reset the shared server's per-IP rate-limit + claim history before each
// browser project so the claim tests don't inherit counter state from the
// previous project's run.
test.beforeAll(async ({ request }) => {
  const res = await request.post('/admin/auth/reset', {
    data: { password: 'admin-pass-123' },
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok()) {
    throw new Error(`admin reset endpoint returned ${res.status()}`);
  }
});

/**
 * Wait for the hashcash runner to report "done" by polling for the progress
 * bar's aria-valuenow reaching 100. The runner writes progressive values and
 * caps at 100 when a valid nonce is found.
 */
async function waitForHashcashSolved(page: Page): Promise<void> {
  const bar = page.locator('[role="progressbar"]');
  // The runner may have already solved before we locate it (difficulty=8 is
  // very fast). Accept either an already-100 value or wait for it.
  await expect(bar).toBeVisible();
  await expect
    .poll(
      async () => {
        try {
          return Number(await bar.getAttribute('aria-valuenow'));
        } catch {
          return -1;
        }
      },
      { timeout: 10_000, intervals: [100, 250, 500] },
    )
    .toBeGreaterThanOrEqual(100);
}

test.describe('claim ui — homepage', () => {
  test('golden path: type address → solve hashcash → click cat → broadcast → confirmed', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#nq-address')).toBeVisible();

    // Cat button should be disabled initially
    const cat = page.getByTestId('claim-cat');
    await expect(cat).toBeDisabled();

    await page.fill('#nq-address', VALID_ADDRESS);

    // The hashcash runner auto-starts and, at difficulty 8, typically resolves
    // in well under a second. Wait until the progress bar is 100% so the
    // cat button becomes enabled.
    await waitForHashcashSolved(page);

    await expect(cat).toBeEnabled();
    await cat.click();

    const status = page.locator('[role="status"]');
    await expect(status).toBeVisible();
    // Eventually the claim confirms via WS+polling; accept any of broadcast/
    // confirmed on the way and require the txId pattern to land.
    await expect(status).toContainText(/Broadcast|Confirmed|Sent|Success/i, { timeout: 15_000 });
    await expect(status.getByText(/tx_e2e_/)).toBeVisible({ timeout: 10_000 });
  });

  test('invalid address keeps cat button disabled and surfaces inline error', async ({ page }) => {
    await page.goto('/');
    await page.fill('#nq-address', 'not-a-nimiq-address');
    const cat = page.getByTestId('claim-cat');
    await expect(cat).toBeDisabled();
    await expect(page.locator('#nq-address-error')).toBeVisible();
  });

  test('hashcash is advertised + progress bar reaches 100 before cat enables', async ({
    page,
    request,
  }) => {
    const cfg = await request.get('/v1/config');
    expect(cfg.ok()).toBeTruthy();
    const body = (await cfg.json()) as { hashcash?: { difficulty: number } };
    expect(body.hashcash).toBeTruthy();
    expect(body.hashcash?.difficulty).toBeGreaterThanOrEqual(8);

    await page.goto('/');
    await page.fill('#nq-address', ANOTHER_ADDRESS);
    await waitForHashcashSolved(page);
    await expect(page.getByTestId('claim-cat')).toBeEnabled();
  });

  test('rate limit: sixth claim from the same IP hits the daily cap', async ({ request }) => {
    // The per-IP per-day cap is 5. Five same-IP claims should succeed, the
    // sixth must be rejected with decision=deny & a rate-limit reason. We use
    // distinct addresses so only the IP cap (not duplicate-address guards)
    // fires.
    const addrs = Array.from(
      { length: 6 },
      (_v, i) => `NQ00 ${String(i).repeat(4)} 5555 5555 5555 5555 5555 5555 5555`,
    );

    const responses: Array<{ status: number; body: unknown }> = [];
    for (const address of addrs) {
      // Hashcash is enabled in globalSetup, so claims without a solution get
      // a `challenge` decision (202) before rate-limit's allow-path can
      // increment the per-IP counter. Solve a fresh challenge per request.
      const chalRes = await request.post('/v1/challenge', {
        data: {},
        headers: { 'content-type': 'application/json' },
      });
      const chal = (await chalRes.json()) as HashcashChallenge;
      const nonce = await solveChallenge(chal.challenge, chal.difficulty);
      const res = await request.post('/v1/claim', {
        data: { address, hashcashSolution: `${chal.challenge}#${nonce}` },
        headers: { 'content-type': 'application/json' },
      });
      responses.push({ status: res.status(), body: await res.json().catch(() => null) });
    }

    const last = responses[responses.length - 1];
    expect([403, 429]).toContain(last!.status);
    const body = last!.body as { decision?: string; reason?: string; error?: string } | null;
    const reasonBlob = `${body?.decision ?? ''} ${body?.reason ?? ''} ${body?.error ?? ''}`.toLowerCase();
    expect(reasonBlob).toMatch(/cap|rate|limit|too many/);
  });
});

test.describe('claim ui — status page', () => {
  test('status page loads and shows performance section', async ({ page }) => {
    await page.goto('/status');
    await expect(page.getByText('Faucet Performance')).toBeVisible();
    await expect(page.getByText('Successful Claims')).toBeVisible();
    await expect(page.getByText('Abuse Attempts Stopped')).toBeVisible();
    await expect(page.getByText('System Health')).toBeVisible();
  });

  test('status page shows recent claims log', async ({ page }) => {
    await page.goto('/status');
    await expect(page.getByText('Recent Claims Log')).toBeVisible();
  });

  test('status page shows system events', async ({ page }) => {
    await page.goto('/status');
    await expect(page.getByText('System Events')).toBeVisible();
  });
});

test.describe('claim ui — activity log', () => {
  test('activity log page loads', async ({ page }) => {
    await page.goto('/log');
    await expect(page.getByText('Full Activity Log')).toBeVisible();
  });

  test('activity log has status filter', async ({ page }) => {
    await page.goto('/log');
    await expect(page.locator('select')).toBeVisible();
  });
});

test.describe('claim ui — navigation', () => {
  test('navbar links navigate between routes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#nq-address')).toBeVisible();

    // Navigate to Status via the navbar link
    await page.getByRole('link', { name: 'Status' }).click();
    await expect(page.getByText('Faucet Performance')).toBeVisible();

    // Navigate back home
    await page.goto('/');
    await expect(page.locator('#nq-address')).toBeVisible();
  });
});
