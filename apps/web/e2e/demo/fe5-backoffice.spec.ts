import { expect, type Page, test } from '@playwright/test';
import { PERSONA } from '../../src/lib/demo/fixtures/staf';
import { createAccount, loginAs } from '../support/accounts';

/**
 * FE5 · Alur layar back office fase 8 dan kanal fase 9 di mode presentasi (ADR-0023): setiap layar dijalankan dari
 * keadaan awal sampai tugas utamanya selesai, termasuk gerbang beralasan. Semua aksi simulasi (tidak disimpan).
 */

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('FE5 · back office', () => {
  test('B09 RM administratif: hak subjek data berpemisahan tugas, peminjaman berkas, pemusnahan berurutan', async ({
    page,
  }) => {
    const rm = await createAccount({ roles: ['petugas_rm'] });
    await loginAs(page, rm, '/');
    await page.goto('/rekam-medis/administrasi');
    await expect(page.getByRole('heading', { name: 'Rekam medis administratif', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ringkasan rekam medis administratif' })).toContainText(
      '1 lewat tenggat',
    );

    // Pelepasan ke asuransi: verifikasi → penyetuju ≠ penerima → kirim bertanda air.
    const verify = page.getByRole('button', { name: 'Verifikasi selesai' });
    await expect(verify).toBeDisabled();
    await expect(page.getByText('Centang ketiga pemeriksaan dulu (0/3).')).toBeVisible();
    for (const box of await page.getByRole('checkbox').all()) await box.check();
    await verify.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'identitas dan dasar diverifikasi' }),
    ).toBeVisible();
    await page.getByLabel('Penyetuju').selectOption(PERSONA.petugasRm);
    const approve = page.getByRole('button', { name: 'Setujui pelepasan' });
    await expect(approve).toBeDisabled();
    await expect(page.getByText(/Penyetuju harus berbeda dari penerima/)).toBeVisible();
    await page.getByLabel('Penyetuju').selectOption(PERSONA.petugasPrivasi);
    await approve.click();
    await page.getByRole('button', { name: 'Kirim berkas bertanda air' }).click();
    await expect(page.getByText(/tautan sekali pakai berlaku 24 jam/)).toBeVisible();
    await expect(page.getByRole('button', { name: /ROI-2610-007/ })).toContainText('Dipenuhi');

    // Permintaan pengadilan ditolak beralasan.
    await page.getByRole('button', { name: /ROI-2610-005/ }).click();
    await page.getByRole('button', { name: 'Tolak permintaan…' }).click();
    const reject = page.getByRole('alertdialog', { name: 'Tolak ROI-2610-005?' });
    await expect(reject.getByRole('button', { name: 'Tolak permintaan' })).toBeDisabled();
    await reject.getByLabel(/Alasan penolakan/).fill('Penetapan asli belum diperlihatkan');
    await reject.getByRole('button', { name: 'Tolak permintaan' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Ditolak' })).toContainText(
      'Penetapan asli belum diperlihatkan',
    );

    // Peminjaman: terlambat → catat kembali; legal hold tidak bisa keluar.
    await page.getByRole('tab', { name: /Peminjaman berkas/ }).click();
    const loans = page.getByRole('region', { name: 'Daftar peminjaman berkas' });
    await expect(loans.getByText('Terlambat 3 hari')).toBeVisible();
    await loans.getByRole('button', { name: 'Kirim pengingat untuk berkas RM 00-50-11-36' }).click();
    await expect(loans.getByText(/Pengingat terkirim/)).toBeVisible();
    await loans.getByRole('button', { name: 'Catat kembali berkas RM 00-50-11-36' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'kembali ke rak' })).toBeVisible();
    await page.getByLabel('Berkas (RM · pasien · rak)').selectOption('berkas-04');
    await expect(page.getByRole('button', { name: 'Catat berkas keluar' })).toBeDisabled();
    await expect(page.getByText(/hanya dibaca di ruang RM/)).toBeVisible();
    await page.getByLabel('Berkas (RM · pasien · rak)').selectOption('berkas-03');
    await page.getByLabel('Nama peminjam').fill('dr. Bagus Santoso, Sp.JP');
    await page.getByLabel('Keperluan').fill('Riwayat kateterisasi 2024 untuk kontrol');
    await page.getByRole('button', { name: 'Catat berkas keluar' }).click();
    await expect(
      page.getByText(/Berkas RM 00-17-55-90 keluar .* kembali paling lambat Kam, 8 Okt 2026/),
    ).toBeVisible();

    // Pemusnahan: elektronik ditolak; fisik berurutan sampai berita acara.
    await page.getByRole('tab', { name: 'Retensi & pemusnahan' }).click();
    await expect(page.getByRole('button', { name: 'Musnahkan data elektronik' })).toBeDisabled();
    for (const step of [
      'Usulkan ke komite RM',
      'Setujui pemusnahan (direktur)',
      'Terbitkan berita acara (TTE)',
      'Catat pemusnahan selesai',
    ]) {
      await page.getByRole('button', { name: step }).click();
    }
    await expect(
      page.getByText(/Pemusnahan 2\.217 berkas fisik tercatat dengan berita acara BAP-2026-003/),
    ).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });
});
