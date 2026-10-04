import { expect, test } from '@playwright/test';
import { createAccount, createSignedDocument } from './support/accounts';

test.describe('verifikasi QR dokumen (/verifikasi/[kode])', () => {
  test('publik tanpa login: tanda tangan sah, penanda tangan + hash; tanpa judul dokumen dan identitas pasien', async ({
    page,
  }) => {
    const dokter = await createAccount({ roles: ['dokter'], displayName: 'dr. Rahmat Hidayat, Sp.PD' });
    const doc = await createSignedDocument(dokter, {
      title: 'Resume medis Pasien Rahasia Fiktif',
      signed: true,
    });
    await page.goto(`/verifikasi/${doc.code}`);
    await expect(page).toHaveURL(new RegExp(`/verifikasi/${doc.code.replace(/\./g, '\\.')}$`));
    await expect(page.getByRole('heading', { name: 'Tanda tangan elektronik sah', level: 1 })).toBeVisible();
    await expect(page.getByText('Resume · RS Fiktif Andalas')).toBeVisible();
    await expect(page.getByText('dr. Rahmat Hidayat, Sp.PD').first()).toBeVisible();
    await expect(page.getByText(doc.sha256)).toBeVisible();
    const text = await page.locator('main').innerText();
    expect(text).not.toContain(doc.patientName);
    expect(text).not.toContain('Resume medis');
  });

  test('sedang diproses dan kode tidak dikenal', async ({ page }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    const pending = await createSignedDocument(dokter, { title: 'Surat keterangan', signed: false });
    await page.goto(`/verifikasi/${pending.code}`);
    await expect(page.getByRole('heading', { name: 'Tanda tangan sedang diproses' })).toBeVisible();
    await expect(page.getByText('Belum selesai')).toBeVisible();

    await page.goto(
      '/verifikasi/sv1.0199a000-0000-7000-8000-000000000001.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    );
    await expect(page.getByRole('heading', { name: 'Kode verifikasi tidak dikenal' })).toBeVisible();
    await page.goto('/verifikasi/bukan-kode');
    await expect(page.getByRole('heading', { name: 'Kode verifikasi tidak dikenal' })).toBeVisible();
  });
});
