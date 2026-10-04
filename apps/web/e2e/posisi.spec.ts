import { expect, test } from '@playwright/test';
import { createAccount, submitPassword, totpFor, typeCode } from './support/accounts';

test.describe('banyak posisi dalam satu akun (fokus RSCM)', () => {
  test('kode RS terisi RSCM di lokal', async ({ page }) => {
    await page.goto('/masuk');
    await expect(page.getByLabel('Kode RS')).toHaveValue('RSCM');
  });

  test('pilih posisi saat masuk, lalu ganti posisi tanpa keluar; menu mengikuti posisi', async ({ page }) => {
    const demo = await createAccount({ roles: ['perawat', 'petugas_rm', 'kasir'] });
    await page.goto('/masuk');
    await submitPassword(page, demo, demo.password);
    await typeCode(page, totpFor(demo.totpSecret as string));
    await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
    await expect(page.getByRole('heading', { name: 'Pilih posisi dan unit kerja' })).toBeVisible();
    await page.getByText('Perawat', { exact: true }).click();
    await page.getByRole('button', { name: 'Masuk sebagai Perawat' }).click();
    await expect(page.getByText(/Anda masuk sebagai\s*Perawat/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Rekam medis' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Ganti posisi' }).first().click();
    await expect(page.getByRole('heading', { name: 'Ganti posisi', level: 1 })).toBeVisible();
    await expect(page.getByText('· sedang dipakai')).toBeVisible();
    await page.getByText('Petugas rekam medis', { exact: true }).click();
    await page.getByRole('button', { name: 'Pindah ke Petugas rekam medis' }).click();
    await expect(page.getByText(/Anda masuk sebagai\s*Petugas rekam medis/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Rekam medis' }).first()).toBeVisible();
  });

  test('akun satu posisi: tanpa menu Ganti posisi', async ({ page }) => {
    const single = await createAccount({ roles: ['kasir'] });
    await page.goto('/masuk');
    await submitPassword(page, single, single.password);
    await typeCode(page, totpFor(single.totpSecret as string));
    await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
    await expect(page.getByText(/Anda masuk sebagai\s*Kasir/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ganti posisi' })).toHaveCount(0);
  });
});
