import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseEnv } from 'node:util';
import { defineConfig, devices } from '@playwright/test';
import { DEMO_ACCOUNTS_FILE } from './e2e/demo-accounts-file';
import { E2E_API_PORT, E2E_DEMO_PORT, E2E_MOCK_PORT, E2E_MOCK_URL, E2E_WEB_PORT } from './e2e/support/slot';

/**
 * E2E web dengan stack penuh di database tes (simrs_test): mock integrasi (port 4110), API (4010), worker outbox,
 * web build produksi (3010), plus build yang sama dalam mode presentasi/data dummy (3011, ADR-0023) untuk
 * spesifikasi di `e2e/demo/`. API dan worker mengarah ke mock E2E, jadi efek outbox (BPJS, Dukcapil, TTE, …) bisa
 * diamati dan gangguan mock bisa diatur (`e2e/support/mock.ts`).
 * Jalankan: `pnpm with-pg pnpm --filter @simrs/web test:e2e` (tanpa Docker) atau setelah `docker compose up -d`.
 * Port berbeda dari `pnpm dev` (3000/4000/4100) agar server pengembangan yang sedang jalan tidak terpakai.
 *
 * Browser: di Windows Microsoft Edge bawaan (tanpa unduhan browser Playwright); di macOS/Linux Chromium Playwright
 * (`pnpm exec playwright install chromium` sekali). PW_CHANNEL menimpa pilihan ini.
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
const dotenv: Record<string, string | undefined> = existsSync('../../.env')
  ? parseEnv(readFileSync('../../.env', 'utf8'))
  : {};
for (const key of ENV_ALLOWLIST) {
  if (process.env[key] === undefined && dotenv[key] !== undefined) process.env[key] = dotenv[key];
}

const channel = process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium');
// Port dan folder sementara per salinan repo: E2E_API_PORT, E2E_WEB_PORT, E2E_DEMO_PORT, E2E_MOCK_PORT, E2E_TMP_NAME
// (lihat e2e/support/slot.ts dan Tutorial §7).
const API_PORT = E2E_API_PORT;
const WEB_URL = `http://localhost:${E2E_WEB_PORT}`;
const DEMO_URL = `http://localhost:${E2E_DEMO_PORT}`;
const TEST_APP_DB =
  process.env.TEST_APP_DATABASE_URL ??
  'postgresql://simrs_app:app_local@localhost:5432/simrs_test?schema=public';

/**
 * Semua URL di .env yang menunjuk mock pengembangan (MOCK_BASE_URL, BPJS_BASE_URL, SATUSEHAT_AUTH_URL, …) dialihkan
 * ke mock E2E dengan path yang sama, untuk API dan worker. Sistem baru yang ditambahkan ke .env otomatis ikut.
 */
function mockUrlEnv(): Record<string, string> {
  const source = { ...dotenv, ...process.env };
  const devMock = new URL(source.MOCK_BASE_URL ?? 'http://localhost:4100');
  const out: Record<string, string> = { MOCK_BASE_URL: E2E_MOCK_URL };
  for (const [key, value] of Object.entries(source)) {
    if (!key.endsWith('_URL') || !value || !URL.canParse(value)) continue;
    const url = new URL(value);
    if (url.port === devMock.port && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      out[key] = `${E2E_MOCK_URL}${url.pathname.replace(/\/$/, '')}${url.search}`;
    }
  }
  return out;
}
const MOCK_ENV = mockUrlEnv();

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  retries: 0,
  // Stack penuh (API + dua server web + browser paralel) di laptop pengembang yang juga menjalankan server
  // pengembangan: alur panjang (login + beberapa aksi) bisa melewati 30 dtk bawaan. Batas tiap langkah tetap 10 dtk.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
  },
  projects: [
    { name: 'desktop', testIgnore: 'demo/**', use: { ...devices['Desktop Chrome'], channel } },
    {
      name: 'tablet',
      // Spesifikasi yang mengubah skenario mock (keadaan bersama) cukup di proyek desktop.
      testIgnore: ['demo/**', 'infrastruktur.spec.ts'],
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'demo-desktop',
      testMatch: 'demo/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], channel, baseURL: DEMO_URL },
    },
    {
      name: 'demo-tablet',
      testMatch: 'demo/**/*.spec.ts',
      // Akun presentasi uji berbagi satu keadaan simulasi: jalankan di satu proyek saja.
      testIgnore: 'demo/akun-presentasi.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        channel,
        baseURL: DEMO_URL,
        viewport: { width: 768, height: 1024 },
      },
    },
  ],
  // Dinyalakan berurutan sesuai daftar ini, sebelum global setup.
  webServer: [
    {
      // Keadaan mock (skenario, invoice, kotak masuk) di memori: proses baru per jalankan; tes yang mengubah
      // skenario mengembalikannya (e2e/support/mock.ts).
      command: 'pnpm start',
      cwd: '../mock',
      url: `${E2E_MOCK_URL}/_panel/api/state`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        MOCK_PORT: String(E2E_MOCK_PORT),
        HOST: '127.0.0.1',
        TPDI_WEBHOOK_TARGET: `http://127.0.0.1:${API_PORT}/api/v1/webhooks/tpdi`,
      },
    },
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
        // Semua tes datang dari satu IP (loopback) dan akun presentasi dipakai paralel; batas laju diuji di tes API.
        AUTH_RATE_LIMIT_PER_MIN: '10000',
        RATE_LIMIT_PER_MIN: '100000',
        USER_RATE_LIMIT_PER_MIN: '100000',
        LOG_LEVEL: 'warn',
        ...MOCK_ENV,
      },
    },
    {
      // Worker outbox di DB tes, mengirim ke mock E2E. Penjadwal `interval` (timer di proses ini), bukan BullMQ:
      // Redis dipakai bersama semua salinan repo dan `pnpm dev`, antrean BullMQ yang sama akan saling mengambil
      // putaran. Worker tidak punya port HTTP; tanda siap = baris log tetap setelah bootstrap (apps/worker/src/main.ts).
      command: 'pnpm build && pnpm start',
      cwd: '../worker',
      wait: { stdout: /Worker outbox siap/ },
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NODE_ENV: 'development',
        APP_ENV: 'local',
        DATABASE_URL: TEST_APP_DB,
        OUTBOX_SCHEDULER: 'interval',
        OUTBOX_POLL_MS: '500',
        // Skenario `timeout` mock cepat terlihat; mock normal menjawab dalam milidetik.
        OUTBOX_HTTP_TIMEOUT_MS: '2000',
        WEB_BASE_URL: WEB_URL,
        ...MOCK_ENV,
      },
    },
    {
      command: `pnpm exec next build && pnpm exec next start --port ${E2E_WEB_PORT}`,
      url: WEB_URL + '/masuk',
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        // Build produksi selalu NODE_ENV=production, walau pemanggil mewariskan NODE_ENV lain (mis. diekspor di shell);
        // campuran keduanya merusak prerender Next. with-pg tidak lagi meneruskan NODE_ENV dari .env.
        NODE_ENV: 'production',
        APP_ENV: 'local',
        API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
        // Isi awal "Kode RS" pasti sama dengan yang diuji, apa pun isi .env pengembang.
        LOGIN_TENANT_CODE: 'RSCM',
        // Suite utama selalu memakai API, walau .env pengembang berisi DATA_SOURCE=demo.
        DATA_SOURCE: 'api',
      },
    },
    {
      // Build yang sama (sudah dibuat server sebelumnya; server dijalankan berurutan) dalam mode presentasi.
      command: `pnpm exec next start --port ${E2E_DEMO_PORT}`,
      url: DEMO_URL + '/masuk',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'production',
        APP_ENV: 'local',
        API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
        LOGIN_TENANT_CODE: 'RSCM',
        DATA_SOURCE: 'demo',
        // Keadaan simulasi akun uji di folder sementara, bukan `.local/demo-state` milik pengembang.
        DEMO_STATE_DIR: dirname(DEMO_ACCOUNTS_FILE),
        // Akun presentasi uji (dibuat global setup), bukan `.local/demo-accounts.json` milik pengembang.
        DEMO_ACCOUNTS_FILE,
      },
    },
  ],
});
