import { expect, test } from '@playwright/test';

test('landing shell renders the configured event name and privacy note', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Our Event');
  await expect(page.getByText('Your photo stays on this device.')).toBeVisible();
});
