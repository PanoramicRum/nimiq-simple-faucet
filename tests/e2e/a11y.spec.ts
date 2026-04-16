import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * axe-core smoke: fail on any serious/critical WCAG violation on the two
 * primary entry points. Non-blocking levels (moderate, minor) are allowed
 * through — the M5 bar is "no serious+critical regressions".
 */
async function runAxe(url: string, page: import('@playwright/test').Page): Promise<void> {
  await page.goto(url);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v: { impact?: string | null }) => v.impact === 'serious' || v.impact === 'critical',
  );
  if (blocking.length > 0) {
    // eslint-disable-next-line no-console
    console.error('axe violations:', JSON.stringify(blocking, null, 2));
  }
  expect(blocking, 'no serious/critical WCAG violations').toEqual([]);
}

test.describe('a11y smoke', () => {
  test('/ (claim ui) is axe-clean at serious/critical level', async ({ page }) => {
    await runAxe('/', page);
  });

  test('/admin/login is axe-clean at serious/critical level', async ({ page }) => {
    await runAxe('/admin/login', page);
  });
});
