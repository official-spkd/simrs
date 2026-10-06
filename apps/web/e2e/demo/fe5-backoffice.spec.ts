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
  test('B03 SDM: SIP kedaluwarsa diperbarui, NIK dibuka beralasan, pegawai keluar, jadwal dinas terbit', async ({
    page,
  }) => {
    const direksi = await createAccount({ roles: ['manajemen'] });
    await loginAs(page, direksi, '/');
    await page.goto('/manajemen/sdm');
    await expect(page.getByRole('heading', { name: 'SDM dan kepegawaian', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: /dr\. Rina Kusuma/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Kewenangan klinis ditangguhkan' })).toBeVisible();
    const save = page.getByRole('button', { name: 'Simpan SIP baru' });
    await expect(save).toBeDisabled();
    await page.getByLabel('Nomor SIP baru').fill('9999/UM/0533');
    await page.getByLabel('Berlaku sampai').fill('2031-10-05');
    await save.click();
    await expect(page.getByText(/SIP baru dr\. Rina Kusuma dicatat/)).toBeVisible();

    await page.getByRole('button', { name: 'Tampilkan utuh…' }).click();
    const nik = page.getByRole('alertdialog', { name: 'Buka NIK utuh?' });
    await nik.getByLabel(/Alasan/).fill('Verifikasi berkas perpanjangan SIP');
    await nik.getByRole('button', { name: 'Tampilkan NIK' }).click();
    await expect(page.getByText('9999220200000005')).toBeVisible();

    await page.getByRole('button', { name: 'Proses pegawai keluar…' }).click();
    const leave = page.getByRole('alertdialog', { name: /Proses dr\. Rina Kusuma keluar/ });
    await leave.getByLabel(/Alasan/).fill('Mengundurkan diri per 5 Oktober 2026');
    await leave.getByRole('button', { name: 'Proses keluar' }).click();
    await expect(page.getByText(/akun SIM RS dinonaktifkan, penugasan diakhiri/)).toBeVisible();

    await page.getByRole('tab', { name: 'Jadwal dinas' }).click();
    const roster = page.getByRole('tabpanel', { name: 'Jadwal dinas' });
    const publish = roster.getByRole('button', { name: 'Terbitkan jadwal' });
    await expect(publish).toBeDisabled();
    await expect(roster.getByText('2 dinas di bawah jumlah minimum; isi dulu sebelum terbit.')).toBeVisible();
    const fill = async (cell: RegExp, id: string) => {
      await page.getByRole('button', { name: cell }).click();
      await page.getByLabel('Tambah perawat').selectOption(id);
      await page.getByRole('button', { name: 'Tambahkan ke dinas' }).click();
    };
    await fill(/^Siang Rab 14/, 'peg-0014');
    await fill(/^Malam Sab 17/, 'peg-0014');
    await expect(roster.getByText(/1 jeda istirahat malam → pagi dilanggar/)).toBeVisible();
    await page.getByRole('button', { name: /^Pagi Jum 16/ }).click();
    await page.getByRole('button', { name: 'Lepas Ns. Maya Sari, S.Kep' }).click();
    await fill(/^Pagi Jum 16/, 'peg-0011');
    await publish.click();
    await expect(page.getByText(/terbit versi 1 · Sen, 5 Okt 2026/).first()).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });
});
