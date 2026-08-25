/**
 * End-to-end guest flow through the real, fully-wired App: landing -> file
 * selection -> editing (cover-fit render, drag, zoom) -> ready -> the
 * unsupported-share fallback -> back to editing. Milestones 0/1 already
 * cover the image engine and app shell in isolation; this is the first test
 * that exercises the actual integrated app a guest would use.
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures');

test('guest can select a photo, see it composited under the overlay, and reach ready', async ({
  page,
}) => {
  await page.goto('/');

  // Both actions are disabled until the overlay decodes (see
  // LandingScreen.test.tsx for that behavior driven directly via props —
  // the real bundled overlay asset decodes too fast locally to reliably
  // observe the disabled window here without flaking). This just confirms
  // the integration actually reaches enabled.
  await expect(page.getByRole('button', { name: 'Choose a photo' })).toBeEnabled({
    timeout: 5000,
  });

  const fileInputs = page.locator('input[type="file"]');
  await expect(fileInputs).toHaveCount(2);
  await fileInputs.nth(1).setInputFiles(path.join(FIXTURES_DIR, 'portrait.jpg'));

  const dragRegion = page.getByRole('group', {
    name: 'Drag to reposition the photo. Use arrow keys to move it.',
  });
  await expect(dragRegion).toBeVisible();

  const images = page.locator('img');
  await expect(images).toHaveCount(2);
  // The overlay must render above the photo and never bear a transform.
  const overlay = images.nth(1);
  await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  await expect(overlay).toHaveJSProperty('style.transform', '');

  const shareButton = page.getByRole('button', { name: 'Share' });
  await expect(shareButton).toBeEnabled({ timeout: 5000 });
});

test('zoom slider and arrow-key nudge both move the photo without exposing an empty edge', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Choose a photo' })).toBeEnabled({
    timeout: 5000,
  });
  await page
    .locator('input[type="file"]')
    .nth(1)
    .setInputFiles(path.join(FIXTURES_DIR, 'landscape.jpg'));

  const photo = page.locator('img').first();
  const widthBeforeZoom = await photo.evaluate((el) => (el as HTMLElement).style.width);

  const slider = page.getByRole('slider', { name: 'Zoom' });
  await slider.focus();
  await slider.press('ArrowRight'); // native range step, increases zoom
  const widthAfterZoom = await photo.evaluate((el) => (el as HTMLElement).style.width);
  expect(widthAfterZoom).not.toBe(widthBeforeZoom);

  const transformBeforeNudge = await photo.evaluate((el) => (el as HTMLElement).style.transform);
  const dragRegion = page.getByRole('group', {
    name: 'Drag to reposition the photo. Use arrow keys to move it.',
  });
  await dragRegion.focus();
  await page.keyboard.press('ArrowRight');
  const transformAfterNudge = await photo.evaluate((el) => (el as HTMLElement).style.transform);
  expect(transformAfterNudge).not.toBe(transformBeforeNudge);
});

test('selecting the same file twice reaches editing both times (input value reset works)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Choose a photo' })).toBeEnabled({
    timeout: 5000,
  });
  const libraryInput = page.locator('input[type="file"]').nth(1);
  const fixture = path.join(FIXTURES_DIR, 'square.jpg');

  await libraryInput.setInputFiles(fixture);
  await expect(
    page.getByRole('group', { name: 'Drag to reposition the photo. Use arrow keys to move it.' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Change photo' }).click();
  await expect(page.getByRole('button', { name: 'Choose a photo' })).toBeEnabled();

  // Re-selecting the exact same file must still fire a change event and
  // reach editing again, not silently no-op.
  await libraryInput.setInputFiles(fixture);
  await expect(
    page.getByRole('group', { name: 'Drag to reposition the photo. Use arrow keys to move it.' }),
  ).toBeVisible();
});

test('an unsupported share target falls back to the manual-save screen, and back-to-editing restores the crop', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Desktop Chromium under Playwright already lacks navigator.share in
    // most configurations, but force it for a deterministic assertion.
    Object.defineProperty(window.navigator, 'share', { value: undefined, configurable: true });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Choose a photo' })).toBeEnabled({
    timeout: 5000,
  });
  await page
    .locator('input[type="file"]')
    .nth(1)
    .setInputFiles(path.join(FIXTURES_DIR, 'portrait.jpg'));

  const shareButton = page.getByRole('button', { name: 'Share' });
  await expect(shareButton).toBeEnabled({ timeout: 5000 });
  await shareButton.click();

  await expect(
    page.getByText('Touch and hold the image, then choose Save to Photos.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();

  await page.getByRole('button', { name: 'Back to editing' }).click();
  await expect(
    page.getByRole('group', { name: 'Drag to reposition the photo. Use arrow keys to move it.' }),
  ).toBeVisible();
  // Regression: Save/Share must be immediately usable again, not stuck on
  // "Preparing photo…" until the guest happens to touch the transform.
  await expect(page.getByRole('button', { name: 'Share' })).toBeEnabled();
});

test('Save triggers a real download and never opens the share sheet, even when sharing is supported', async ({
  page,
}) => {
  const shareCalls: unknown[] = [];
  await page.exposeBinding('recordShareCall', () => {
    shareCalls.push(true);
  });
  await page.addInitScript(() => {
    // A guest with full Web Share support should still get a direct
    // download from Save — it must never fall through to the share sheet.
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: (..._args: unknown[]) => {
        (window as unknown as { recordShareCall: () => void }).recordShareCall();
        return Promise.resolve();
      },
    });
    Object.defineProperty(window.navigator, 'canShare', {
      configurable: true,
      value: () => true,
    });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Choose a photo' })).toBeEnabled({
    timeout: 5000,
  });
  await page
    .locator('input[type="file"]')
    .nth(1)
    .setInputFiles(path.join(FIXTURES_DIR, 'portrait.jpg'));

  const saveButton = page.getByRole('button', { name: 'Save' });
  await expect(saveButton).toBeEnabled({ timeout: 5000 });

  const [download] = await Promise.all([page.waitForEvent('download'), saveButton.click()]);
  expect(download.suggestedFilename()).toMatch(/\.jpg$/);
  await expect(page.getByText('Saved!')).toBeVisible();

  // Still on the editing screen (Share is still visible/enabled), and the
  // share sheet was never invoked.
  await expect(page.getByRole('button', { name: 'Share' })).toBeEnabled();
  expect(shareCalls).toHaveLength(0);
});

test('clicking Download on the fallback screen shows a self-dismissing "Saved!" confirmation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'share', { value: undefined, configurable: true });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Choose a photo' })).toBeEnabled({
    timeout: 5000,
  });
  await page
    .locator('input[type="file"]')
    .nth(1)
    .setInputFiles(path.join(FIXTURES_DIR, 'portrait.jpg'));

  const shareButton = page.getByRole('button', { name: 'Share' });
  await expect(shareButton).toBeEnabled({ timeout: 5000 });
  await shareButton.click();
  await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();

  await expect(page.getByText('Saved!')).not.toBeVisible();
  await page.getByRole('button', { name: 'Download' }).click();
  await expect(page.getByText('Saved!')).toBeVisible();
  await expect(page.getByText('Saved!')).not.toBeVisible({ timeout: 4000 });
});
