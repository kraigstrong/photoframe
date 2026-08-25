import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level tests for behavior jsdom cannot exercise faithfully: real
 * file decoding, real canvas compositing end-to-end, and share/download
 * fallback branches. See tests/e2e/**.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
