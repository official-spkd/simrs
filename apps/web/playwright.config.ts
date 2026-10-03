import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E web dengan stack penuh: Postgres (simrs_test) + API (port 4010) + web build produksi (port 3010).
 * Jalankan: `pnpm with-pg pnpm --filter @simrs/web test:e2e` (tanpa Docker) atau setelah `docker compose up -d`.
 * Port berbeda dari `pnpm dev` (3000/4000) agar server pengembangan yang sedang jalan tidak terpakai.
 *
 * Lokal memakai Microsoft Edge bawaan Windows (tanpa unduhan browser Playwright); set PW_CHANNEL=chromium
 * setelah `pnpm exec playwright install chromium` bila perlu (mis. CI Linux).
 */
// Dari .env root hanya daftar putih ini (seperti next.config.ts): kunci enkripsi/hash kolom yang sama dengan API
// (akun uji ber-MFA dan pasien fiktif dibuat langsung di simrs_test) dan URL DB tes. Memuat seluruh .env akan ikut mewariskan
// NODE_ENV=development ke `next build` dan merusak build produksi.
const ENV_ALLOWLIST = [
  'FIELD_ENCRYPTION_KEY',
  'FIELD_HASH_KEY',
  'TEST_DATABASE_URL',
  'TEST_APP_DATABASE_URL',
] as const;
if (existsSync('../../.env')) {
  const parsed = parseEnv(readFileSync('../../.env', 'utf8'));
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] === undefined && parsed[key] !== undefined) process.env[key] = parsed[key];
  }
}

const channel = process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium');
const API_PORT = 4010;
const WEB_PORT = 3010;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const TEST_APP_DB =
  process.env.TEST_APP_DATABASE_URL ??
  'postgresql://simrs_app:app_local@localhost:5432/simrs_test?schema=public';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  retries: 0,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
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
  webServer: [
    {
      command: 'pnpm build && pnpm start',
      cwd: '../api',
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        APP_ENV: 'local',
        API_PORT: String(API_PORT),
        HOST: '127.0.0.1',
        DATABASE_URL: TEST_APP_DB,
        WEB_BASE_URL: WEB_URL,
        // Web (BFF) di loopback: IP klien dari X-Forwarded-For kiriman web.
        TRUST_PROXY: 'loopback',
        ALLOW_DEV_TENANT_HEADER: 'false',
        // Semua tes datang dari satu IP (loopback); batas laju diuji di tes API.
        AUTH_RATE_LIMIT_PER_MIN: '10000',
        RATE_LIMIT_PER_MIN: '100000',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `pnpm exec next build && pnpm exec next start --port ${WEB_PORT}`,
      url: WEB_URL + '/masuk',
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        // Build produksi selalu NODE_ENV=production, walau pemanggil (mis. with-pg yang memuat .env) mewariskan
        // NODE_ENV=development; campuran keduanya merusak prerender Next.
        NODE_ENV: 'production',
        APP_ENV: 'local',
        API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
