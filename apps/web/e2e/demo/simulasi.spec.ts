import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/** Layar Simulasi (mode presentasi, ADR-0023): tiga skenario, gerbang tugas, ringkasan, panel panduan. */

async function jumpTo(page: Page, stage: string) {
  await page.getByText('Lompat ke tahap', { exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^\\d+\\. ${stage}$`) }).click();
  await expect(page.getByText(new RegExp(`Langkah \\d+ dari \\d+ · ${stage}`))).toBeVisible();
}

test.describe('simulasi pasien', () => {
  test('rawat jalan: tugas berurutan, jam berjalan, lompat ke akhir, ringkasan sesuai mockup', async ({
    page,
  }, testInfo) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account, '/simulasi');
    await expect(page.getByRole('heading', { name: 'Simulasi pasien end-to-end', level: 1 })).toBeVisible();
    await expect(page.getByText('Tn. Suryo Adi Nugroho')).toBeVisible();
    await expect(page.getByTestId('jam-simulasi')).toHaveText('07.10');

    // Tugas kedua belum gilirannya sebelum tugas pertama selesai.
    await expect(page.getByRole('button', { name: 'Cetak tiket' })).toBeDisabled();
    await page.getByRole('button', { name: 'Pindai kode booking' }).click();
    await expect(page.getByTestId('jam-simulasi')).toHaveText('07.11');
    await expect(page.getByText('Check-in dengan kode booking 2610050117')).toBeVisible();
    await page.getByRole('button', { name: /Pengenalan wajah cocok/ }).click();
    await expect(page.getByRole('button', { name: 'Cetak tiket' })).toBeEnabled();

    // Isian divalidasi server.
    await jumpTo(page, 'Asesmen perawat');
    const td = page.getByRole('textbox', { name: 'Tekanan darah (mmHg)' });
    await td.fill('abc');
    await page.getByRole('button', { name: 'Simpan' }).first().click();
    await expect(page.getByRole('alert').filter({ hasText: 'format sistolik/diastolik' })).toBeVisible();
    await td.fill('120/80');
    await page.getByRole('button', { name: 'Simpan' }).first().click();
    await expect(page.getByText('✓ 120/80')).toBeVisible();

    await jumpTo(page, 'Pasca kunjungan');
    await page.getByRole('button', { name: 'Kirim notifikasi' }).click();
    await page.getByRole('button', { name: /Rujuk balik ke FKTP/ }).click();
    await page.getByRole('button', { name: 'Kirim berkas klaim' }).click();
    await page.getByRole('button', { name: 'Selesaikan simulasi' }).click();
    await expect(page.getByText('Simulasi selesai', { exact: true })).toBeVisible();
    await expect(page.getByTestId('total-tarif')).toHaveText('Rp 806.000');
    await page.screenshot({ path: testInfo.outputPath('simulasi-ringkasan.png'), fullPage: true });
  });

  test('IGD: triase di bawah saran sistem wajib alasan; tab skenario berpindah', async ({
    page,
  }, testInfo) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account, '/simulasi');
    await page.getByRole('tab', { name: 'IGD → rawat inap' }).click();
    await expect(page.getByText('Tn. Hartono Wibisono')).toBeVisible();
    await expect(page.getByTestId('jam-simulasi')).toHaveText('Sab 3 Okt · 21.40');
    await jumpTo(page, 'Triase');
    await page.getByRole('button', { name: 'Simpan' }).first().click();
    await page.getByRole('button', { name: /Level 3 · urgen/ }).click();
    const alasan = page.getByRole('textbox', { name: /tulis alasan klinis/ });
    await expect(alasan).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lanjut: Asesmen dokter' })).toBeDisabled();
    await alasan.fill('pendek');
    await page.getByRole('button', { name: 'Simpan' }).first().click();
    await expect(page.getByRole('alert').filter({ hasText: 'Alasan minimal 10 karakter' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('simulasi-igd-gerbang.png'), fullPage: true });
  });

  test('panel panduan tampil di layar lain dan mengikuti langkah aktif', async ({ page }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account, '/');
    const pill = page.getByRole('button', { name: /^Simulasi · 1 dari 9 · Kedatangan$/ });
    await expect(pill).toBeVisible();
    await pill.click();
    const panel = page.getByRole('complementary', { name: 'Panduan simulasi' });
    await expect(panel.getByText('Tugas berikutnya: Pindai kode booking dari aplikasi pasien')).toBeVisible();
    await panel.getByRole('button', { name: 'Kerjakan 1 tugas (nilai bawaan)' }).click();
    await expect(panel.getByText('Tugas berikutnya: Verifikasi biometrik peserta JKN')).toBeVisible();
    // Layar terkait belum dibangun: keterangan, bukan tombol mati tanpa alasan.
    await expect(panel.getByText('Layar Anjungan mandiri belum tersedia.')).toBeVisible();
  });
});
