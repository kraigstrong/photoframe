import { expect, test } from '@playwright/test';

test('landing shell renders the configured event name and privacy note', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Frame your photo');
  await expect(page.getByText('Panther Prowl 2026')).toBeVisible();
  // Matches the CLAIM rather than one exact phrasing, mirroring the guardrail
  // in src/config/event.test.ts. A reworded privacy line should not fail this
  // test; the line disappearing entirely must. The config itself can't be
  // imported here — event.ts imports PNG assets, which Playwright can't
  // resolve — so this is the closest thing to a shared source of truth.
  await expect(
    page.getByText(/your photo (never leaves|is not uploaded|does not leave)/i),
  ).toBeVisible();
});
