import { expect, test } from '@playwright/test';

test.describe('smoke fase 0', () => {
  test('beranda tampil dengan navigasi dan status sistem', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Beranda', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Status sistem' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
  });

  test('menu yang belum dibangun tidak bisa diklik dan menjelaskan alasannya', async ({ page, viewport }) => {
    await page.goto('/');
    if ((viewport?.width ?? 1280) < 768) return;
    const igd = page.getByTitle('IGD · layar belum tersedia').first();
    await expect(igd).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('link', { name: 'IGD' })).toHaveCount(0);
  });

  test('/dev/ui: gerbang alasan pembatalan bekerja', async ({ page }) => {
    await page.goto('/dev/ui');
    await expect(page.getByRole('heading', { name: 'Klinis Bersih' })).toBeVisible();
    await page.getByRole('button', { name: 'Batalkan tindakan' }).click();
    const confirm = page.getByRole('button', { name: 'Ya, batalkan' });
    await expect(confirm).toBeDisabled();
    await page.getByLabel('Alasan pembatalan').fill('Pasien menolak tindakan');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'dibatalkan dengan alasan tercatat' }),
    ).toBeVisible();
  });

  test('/dev/ui: validasi NIK menjelaskan cara memperbaiki', async ({ page }) => {
    await page.goto('/dev/ui');
    const nik = page.getByLabel(/^NIK/);
    await nik.fill('12345');
    await expect(page.getByText('NIK harus 16 digit (sekarang 5).')).toBeVisible();
    await expect(nik).toHaveAttribute('aria-invalid', 'true');
    await nik.fill('9999010101900001');
    await expect(page.getByText('Format benar · siap dicek ke Dukcapil')).toBeVisible();
  });

  test('tidak ada scroll horizontal', async ({ page }) => {
    for (const path of ['/', '/dev/ui']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
