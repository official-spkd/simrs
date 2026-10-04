import { expect, test } from '@playwright/test';
import { SCREENS } from '../src/lib/screens';
import { createAccount, loginAs } from './support/accounts';

test.describe('smoke', () => {
  test('/masuk tampil tanpa login, berbahasa Indonesia, dengan header keamanan', async ({ page }) => {
    const res = await page.goto('/masuk');
    expect(res?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
    await expect(page.getByRole('heading', { name: 'Masuk ke SIM RS' })).toBeVisible();
    const headers = res?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
  });

  test('beranda: menu sesuai peran; menu yang belum dibangun tidak bisa diklik', async ({
    page,
    viewport,
  }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    await expect(page.getByRole('heading', { name: 'Beranda', level: 1 })).toBeVisible();
    // Di luar mode presentasi tidak ada lencana data fiktif (ADR-0023).
    await expect(page.getByText('Mode presentasi · data fiktif')).toHaveCount(0);
    if ((viewport?.width ?? 1280) < 768) return;
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    const igd = nav.getByTitle('IGD · layar belum tersedia').first();
    await expect(igd).toHaveAttribute('aria-disabled', 'true');
    await expect(nav.getByRole('link', { name: 'IGD' })).toHaveCount(0);
    // Perawat tidak memegang izin kelola pengguna: menunya tidak tampil.
    await expect(nav.getByText('Pengguna & akses')).toHaveCount(0);
    await expect(nav.getByText('Perawat', { exact: true })).toHaveCount(1);
    await expect(nav.getByText('Semua unit', { exact: true })).toBeVisible();
  });

  test('layar mode presentasi tidak ada di luar mode demo (404)', async ({ page }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    const paths = [
      ...SCREENS.filter((s) => s.status === 'demo').map((s) => s.route),
      '/klinis/order/kj-suryo',
      '/klinis/rawat-inap/kj-hartono',
      '/klinis/resume/kj-hartono',
      '/tablet/persetujuan/pk-hartono',
    ];
    for (const path of paths) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });

  test.describe('/dev/ui (operator platform)', () => {
    test.beforeEach(async ({ page }) => {
      const operator = await createAccount({ tenant: 'PLATFORM', roles: ['superadmin_platform'] });
      await loginAs(page, operator, '/dev/ui');
    });

    test('gerbang alasan pembatalan bekerja', async ({ page }) => {
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

    test('validasi NIK menjelaskan cara memperbaiki', async ({ page }) => {
      const nik = page.getByLabel(/^NIK/);
      await nik.fill('12345');
      await expect(page.getByText('NIK harus 16 digit (sekarang 5).')).toBeVisible();
      await expect(nik).toHaveAttribute('aria-invalid', 'true');
      await nik.fill('9999010101900001');
      await expect(page.getByText('Format benar · siap dicek ke Dukcapil')).toBeVisible();
    });

    test('tidak ada scroll horizontal', async ({ page }) => {
      for (const path of ['/', '/dev/ui', '/superadmin/panduan']) {
        await page.goto(path);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
    });
  });

  test('/masuk tanpa scroll horizontal', async ({ page }) => {
    await page.goto('/masuk');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
