import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type ConsoleMessage, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { PRESENTATION_PERSONAS } from '@simrs/db';
import { type Account, createAccount, loginAs, type TenantCode } from '../support/accounts';

/**
 * Alat bantu tangkap layar dokumentasi (`pnpm docs:gambar`, docs/panduan/18-simulasi-dan-operasional.md). Hanya
 * berjalan bila `DOCS_CAPTURE=1`; selain itu spesifikasi di folder ini dilewati, jadi `pnpm test:e2e` biasa tidak
 * menimpa gambar di repo.
 */
export const DOCS_CAPTURE = process.env.DOCS_CAPTURE === '1';

/** Ukuran tangkapan dokumentasi (sama dengan layar laptop presentasi). */
export const DOCS_VIEWPORT = { width: 1366, height: 768 } as const;

/** Batas lunak ukuran berkas: di atasnya tes memberi peringatan (bukan gagal). */
const SIZE_WARN_BYTES = 300 * 1024;

/** `docs/panduan/gambar/` di akar repo (dari letak playwright.config.ts), atau `DOCS_CAPTURE_DIR`. */
export function docsImageDir(info: TestInfo): string {
  const fromEnv = process.env.DOCS_CAPTURE_DIR;
  const dir = fromEnv
    ? resolve(fromEnv)
    : resolve(
        dirname(info.config.configFile ?? join(process.cwd(), 'playwright.config.ts')),
        '..',
        '..',
        'docs',
        'panduan',
        'gambar',
      );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Nama gambar = id layar registri, atau `<id>--<langkah>` (huruf kecil, angka, '-'; pola sama dengan `lib/guide.ts`). */
const NAME = /^[a-z0-9][a-z0-9-]{0,95}$/;

/**
 * Nama tampilan fiktif per peran: nama persona akun presentasi (`PRESENTATION_PERSONAS`), agar header tangkapan
 * sama dengan yang dilihat klien saat presentasi (bukan "Pengguna E2E Fiktif").
 */
export function personaName(role: string): string {
  if (role === 'superadmin_platform') return 'Operator Platform Fiktif';
  return PRESENTATION_PERSONAS.find((p) => p.role === role)?.displayName ?? 'Staf Fiktif';
}

/** Akun uji baru (keadaan simulasi baru) untuk satu peran, lalu masuk dan buka `path`. */
export async function openAs(
  page: Page,
  role: string,
  path: string,
  opts: { tenant?: TenantCode; unitName?: string } = {},
): Promise<Account> {
  const account = await createAccount({
    tenant: opts.tenant ?? 'RSFA',
    roles: [role],
    displayName: personaName(role),
    unitName: opts.unitName,
  });
  await loginAs(page, account, path);
  if (!page.url().endsWith(path)) await page.goto(path);
  return account;
}

/** Catat galat JavaScript halaman selama tangkapan (galat = layar rusak, gambar jangan dipakai). */
export function watchErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && !`${msg.text()} ${msg.location().url}`.includes('favicon')) {
      errors.push(msg.text());
    }
  });
  return () => errors;
}

/**
 * Simpan tangkapan viewport 1366×768 sebagai `<name>.png`. `focus` digulir ke tengah layar dulu (mis. gerbang CDS
 * di bawah lipatan). Animasi dimatikan dan kursor teks disembunyikan agar gambar stabil antar-jalankan.
 */
export async function shoot(
  page: Page,
  info: TestInfo,
  name: string,
  opts: { focus?: Locator } = {},
): Promise<void> {
  if (!NAME.test(name)) throw new Error(`Nama gambar tidak sah: ${name}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/Application error|Terjadi kesalahan/)).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  if (opts.focus) {
    await opts.focus.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  }
  // Kursor di pojok agar tidak ada efek hover yang kebetulan.
  await page.mouse.move(0, 0);
  const file = join(docsImageDir(info), `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', scale: 'css' });
  const bytes = statSync(file).size;
  info.annotations.push({ type: 'gambar', description: `${name}.png · ${Math.round(bytes / 1024)} KB` });
  if (bytes > SIZE_WARN_BYTES) {
    info.annotations.push({ type: 'peringatan', description: `${name}.png > 300 KB (${bytes} byte)` });
  }
}
