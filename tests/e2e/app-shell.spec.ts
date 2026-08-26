import { expect, test } from '@playwright/test';

test('landing shell renders the configured event name and privacy note', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Frame your photo');
  await expect(page.getByText('Panther Prowl 2026')).toBeVisible();
  await expect(page.getByText('Not uploaded — stays on your phone.')).toBeVisible();
});
