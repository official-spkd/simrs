import { expect, test } from '@playwright/test';
import {
  createAccount,
  latestBackupCode,
  setStaffPhone,
  submitPassword,
  totpFor,
  typeCode,
} from './support/accounts';

test.describe('masuk: kode cadangan dan perangkat tepercaya (mockup Login)', () => {
  test('tanpa aplikasi autentikator: kirim kode lewat WhatsApp lalu masuk', async ({ page }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await setStaffPhone(perawat, '6281200005555');
    await page.goto('/masuk');
    await submitPassword(page, perawat, perawat.password);
    await expect(page.getByRole('heading', { name: 'Verifikasi dua langkah' })).toBeVisible();

    await page.getByRole('button', { name: 'Kirim kode lewat WhatsApp' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Kode dikirim ke nomor WhatsApp 0812•••5555' }),
    ).toBeVisible();
    // Kiriman ulang terlalu cepat ditolak dengan jelas.
    await page.getByRole('button', { name: 'email' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: /Email belum terdaftar|Tunggu 30 detik/ }),
    ).toBeVisible();

    await typeCode(page, await latestBackupCode(perawat));
    await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
    await expect(page).not.toHaveURL(/\/masuk/);
  });

  test('percayai perangkat 12 jam: setelah keluar, masuk lagi tanpa langkah kode', async ({ page }) => {
    const rm = await createAccount({ roles: ['petugas_rm'] });
    await page.goto('/masuk');
    await submitPassword(page, rm, rm.password);
    await typeCode(page, totpFor(rm.totpSecret as string));
    await page.getByLabel('Percayai perangkat ini selama 12 jam (hanya komputer milik RS)').check();
    await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
    await expect(page).not.toHaveURL(/\/masuk/);

    await page.getByRole('button', { name: 'Keluar' }).first().click();
    await expect(page).toHaveURL(/\/masuk/);
    await submitPassword(page, rm, rm.password);
    await expect(page).not.toHaveURL(/\/masuk/);
    await expect(page.getByRole('heading', { name: 'Verifikasi dua langkah' })).toHaveCount(0);

    // Akun lain di perangkat yang sama tetap wajib kode.
    await page.getByRole('button', { name: 'Keluar' }).first().click();
    const other = await createAccount({ roles: ['petugas_rm'] });
    await submitPassword(page, other, other.password);
    await expect(page.getByRole('heading', { name: 'Verifikasi dua langkah' })).toBeVisible();
  });

  test('peran sensitif (bawaan pengaturan RS): tanpa tautan kode cadangan, tetap bisa masuk dengan aplikasi', async ({
    page,
  }) => {
    const kasir = await createAccount({ roles: ['kasir'] });
    await page.goto('/masuk');
    await submitPassword(page, kasir, kasir.password);
    await expect(page.getByRole('heading', { name: 'Verifikasi dua langkah' })).toBeVisible();
    await expect(page.getByText('Akun ini wajib memakai aplikasi autentikator')).toBeVisible();
    await expect(page.getByRole('button', { name: /Kirim kode lewat/ })).toHaveCount(0);
    await typeCode(page, totpFor(kasir.totpSecret as string));
    await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
    await expect(page).not.toHaveURL(/\/masuk/);
  });
});
