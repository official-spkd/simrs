import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test web. Lokal memakai Microsoft Edge bawaan Windows (tanpa unduhan browser Playwright);
 * set PW_CHANNEL=chromium setelah `pnpm exec playwright install chromium` bila perlu (mis. CI Linux).
 */
const channel = process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel } },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 768, height: 1024 } },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
