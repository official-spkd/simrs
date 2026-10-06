import { type ConsoleMessage, expect, type Page, test } from '@playwright/test';
import { CONSENT_ID, ENCOUNTER_ID } from '../../src/lib/demo/fixtures/ids';
import { SCREENS, type ScreenDef } from '../../src/lib/screens';

/**
 * Posisi Superadmin demo (ADR-0023 keputusan 10): satu akun presentasi yang di mode presentasi membuka SETIAP layar
 * registri dari satu sidebar tanpa ganti posisi, plus panduan sistem. Masuk lewat "Masuk cepat" (login biasa: sandi +
 * TOTP oleh server). Akun presentasi berbagi satu keadaan simulasi, jadi spesifikasi ini hanya membaca layar dan
 * berjalan di proyek demo-desktop saja (diabaikan demo-tablet di playwright.config.ts).
 */

/** Layar yang bisa dibuka di mode presentasi (layar khusus api seperti Kendali antrean memang 404 di sini). */
const reachable = SCREENS.filter((s) => s.status !== 'belum' && !s.apiOnly);

/** Contoh data bawaan untuk layar berparameter: pasien biasa (bukan pasien skenario yang bergantung tahap). */
const PARAM_PATHS: Record<string, readonly string[]> = {
  order: [`/klinis/order/${ENCOUNTER_ID.rohana}`],
  ranap: [`/klinis/rawat-inap/${ENCOUNTER_ID.endang}`],
  consent: [`/tablet/persetujuan/${CONSENT_ID.hendro}`],
};

async function loginSuperadminDemo(page: Page): Promise<void> {
  await page.goto('/masuk');
  const quick = page.getByRole('region', { name: 'Masuk cepat · mode presentasi' });
  // Paling atas di daftar akun.
  await expect(quick.getByRole('button').first()).toContainText('Superadmin demo · semua layar');
  await quick.getByRole('button', { name: /^Superadmin demo · semua layar/ }).click();
  await expect(page.getByRole('heading', { name: 'Beranda', level: 1 })).toBeVisible();
  await expect(page.getByText(/Anda masuk sebagai\s*Superadmin demo · semua layar/)).toBeVisible();
}

async function checkScreen(page: Page, screen: ScreenDef, path: string): Promise<void> {
  const errors: string[] = [];
  const onError = (err: Error) => errors.push(err.message);
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push(msg.text());
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  try {
    const res = await page.goto(path);
    expect(res?.status(), `${path}: status HTTP`).toBe(200);
    await expect(page.getByText('Layar ini untuk posisi lain')).toHaveCount(0);
    await expect(page.getByText('Akses ditolak', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Application error|Terjadi kesalahan/)).toHaveCount(0);
    if (screen.layout === 'perangkat') {
      await expect(page.locator('[role="region"][data-scale]').first()).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    }
    expect(errors, `${path}: galat JavaScript/konsol`).toEqual([]);
  } finally {
    page.off('pageerror', onError);
    page.off('console', onConsole);
  }
}

test.describe('mode presentasi · Superadmin demo', () => {
  test('sidebar memuat semua layar registri sekali, plus panduan; panduan terbuka', async ({ page }) => {
    await loginSuperadminDemo(page);
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    const hrefs = await nav.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    for (const s of reachable) expect(hrefs, `menu ${s.id}`).toContain(s.route);
    expect(hrefs).toContain('/superadmin/panduan');
    const menu = hrefs.filter((h) => h !== '/');
    expect(new Set(menu).size, 'tanpa duplikasi').toBe(menu.length);
    for (const title of ['FRONT OFFICE', 'KLINIS', 'PENUNJANG', 'KEUANGAN', 'BACK OFFICE', 'SISTEM']) {
      await expect(nav.getByText(title, { exact: true })).toBeVisible();
    }
    await expect(nav.getByText('PERANGKAT & PRATINJAU', { exact: true })).toBeVisible();
    await expect(nav.getByText('Superadmin demo · semua layar')).toBeVisible();

    await nav.getByRole('link', { name: 'Panduan sistem' }).click();
    await expect(page.getByRole('heading', { name: 'Panduan sistem SIM RS', level: 1 })).toBeVisible();
    await expect(page.getByText('Dibuka sebagai Superadmin demo (hanya baca)')).toBeVisible();
    // Area superadmin lain tetap khusus operator platform.
    expect((await page.goto('/dev/ui'))?.status()).toBe(404);
  });

  test('"Bertindak sebagai": bawaan pemakai pertama layar, pilihan presenter berlaku di layar yang memakainya', async ({
    page,
  }) => {
    await loginSuperadminDemo(page);
    await page.goto('/klinis/poli');
    const picker = page.getByLabel('Bertindak sebagai');
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: 'Perawat' });
    await expect(picker).toHaveValue('perawat');
    await page.reload();
    await expect(page.getByLabel('Bertindak sebagai')).toHaveValue('perawat');
    // Layar satu posisi: tidak ada pilihan, posisi itu yang dibawakan.
    await page.goto('/keuangan/kasir');
    await expect(page.getByText(/Bertindak sebagai:\s*Kasir/)).toBeVisible();
    // Kembali ke bawaan agar spesifikasi lain tidak terpengaruh pilihan ini.
    await page.goto('/klinis/poli');
    await page.getByLabel('Bertindak sebagai').selectOption({ label: 'Dokter (DPJP)' });
    await expect(page.getByLabel('Bertindak sebagai')).toHaveValue('dokter');
  });

  // Dibagi beberapa tes agar berjalan paralel; satu akun boleh punya beberapa sesi.
  const CHUNKS = 4;
  for (let i = 0; i < CHUNKS; i++) {
    const screens = reachable.filter((_, n) => n % CHUNKS === i);
    test(`setiap layar terbuka tanpa ganti posisi (${i + 1}/${CHUNKS})`, async ({ page }) => {
      test.setTimeout(60_000 + screens.length * 20_000);
      await loginSuperadminDemo(page);
      for (const screen of screens) {
        await test.step(`${screen.id} ${screen.route}`, async () => {
          await checkScreen(page, screen, screen.route);
        });
        for (const path of PARAM_PATHS[screen.id] ?? []) {
          await test.step(`${screen.id} ${path}`, async () => {
            await checkScreen(page, screen, path);
          });
        }
      }
    });
  }
});
