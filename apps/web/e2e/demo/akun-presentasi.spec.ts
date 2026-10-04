import { expect, test } from '@playwright/test';

/**
 * Akun presentasi pilih-klik (ADR-0023): masuk tanpa mengetik sandi/kode, berpindah akun lewat panduan, dan keadaan
 * simulasi dibagi bersama oleh semua akun presentasi. Akun presentasi uji berbagi satu keadaan, jadi spesifikasi ini
 * berjalan berurutan dan hanya di proyek demo-desktop (diabaikan proyek demo-tablet di playwright.config.ts).
 */
test.describe.configure({ mode: 'serial' });

test('pilih akun di layar masuk → beranda sesuai posisi; keluar kembali ke daftar akun', async ({ page }) => {
  await page.goto('/masuk');
  const quick = page.getByRole('region', { name: 'Masuk cepat · mode presentasi' });
  await expect(quick).toBeVisible();
  await expect(quick.getByText('Klinis', { exact: true })).toBeVisible();
  await quick.getByRole('button', { name: /^Perawat/ }).click();
  await expect(page.getByRole('heading', { name: 'Beranda', level: 1 })).toBeVisible();
  await expect(page.getByText(/Anda masuk sebagai\s*Perawat/)).toBeVisible();
  await expect(page.getByText('Mode presentasi · data fiktif')).toBeVisible();
  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page.getByRole('region', { name: 'Masuk cepat · mode presentasi' })).toBeVisible();
});

test('panduan berpindah ke akun presentasi posisi lain; keadaan simulasi tetap sama', async ({ page }) => {
  await page.goto('/masuk');
  await page
    .getByRole('region', { name: 'Masuk cepat · mode presentasi' })
    .getByRole('button', { name: /^Perawat/ })
    .click();
  await expect(page.getByText(/Anda masuk sebagai\s*Perawat/)).toBeVisible();

  await page.goto('/simulasi');
  await page.getByRole('button', { name: 'Mulai ulang' }).click();
  await expect(page.getByTestId('jam-simulasi')).toHaveText('07.10');
  await page.getByText('Lompat ke tahap', { exact: true }).click();
  await page.getByRole('button', { name: /^9\. Pasca kunjungan$/ }).click();
  await page.getByRole('button', { name: 'Kirim notifikasi' }).click();
  await page.getByRole('button', { name: /Rujuk balik ke FKTP/ }).click();
  await page.getByRole('button', { name: 'Kirim berkas klaim' }).click();
  await page.getByRole('button', { name: 'Selesaikan simulasi' }).click();
  await expect(page.getByText('Simulasi selesai', { exact: true })).toBeVisible();

  // Dasbor dipakai posisi Manajemen: perawat dipindahkan ke akun presentasi direksi.
  await page.getByRole('button', { name: /Buka layar Dasbor eksekutif sebagai Manajemen/ }).click();
  await expect(page).toHaveURL(/\/manajemen\/dasbor/);
  await expect(page.getByRole('heading', { name: /Kinerja rumah sakit/, level: 1 })).toBeVisible();

  // Keadaan simulasi milik semua akun presentasi: direksi melihat simulasi yang sama sudah selesai.
  await page.goto('/simulasi');
  await expect(page.getByText('Simulasi selesai', { exact: true })).toBeVisible();
  await expect(page.getByTestId('total-tarif')).toHaveText('Rp 806.000');
});
