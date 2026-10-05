import { expect, type Page, test } from '@playwright/test';
import { scheduleCellId } from '@simrs/shared';
import { DOCTOR_ID } from '../../src/lib/demo/fixtures/ids';
import { createAccount, loginAs } from '../support/accounts';

/**
 * Front office mode presentasi (ADR-0023; mockup Registrasi, Jadwal, Anjungan, DisplayAntrean). Akun uji baru
 * punya keadaan simulasi sendiri: skenario rawat jalan mulai di langkah kedatangan (anjungan).
 */

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('pendaftaran rawat jalan', () => {
  test('stepper, alasan tombol utama, cari pasien → cek BPJS → rujukan → SEP → antrean', async ({ page }) => {
    const petugas = await createAccount({ roles: ['petugas_pendaftaran'] });
    await loginAs(page, petugas, '/pendaftaran');
    await page.goto('/pendaftaran');
    await expect(
      page.getByRole('heading', { name: 'Pendaftaran pasien rawat jalan', level: 1 }),
    ).toBeVisible();
    const steps = page.getByRole('list', { name: 'Langkah pendaftaran' });
    await expect(steps.getByRole('listitem')).toHaveCount(4);
    await expect(steps.locator('[aria-current="step"]')).toContainText('Penjamin');
    await expect(page.getByRole('button', { name: 'Panggil berikutnya · A-028' })).toBeVisible();

    await page.getByLabel('Cari pasien (NIK, No. RM, No. BPJS, nama + tgl lahir)').fill('00-12-45-78');
    await page.getByRole('button', { name: 'Cari pasien', exact: true }).click();
    const identity = page.getByRole('region', { name: 'Identitas pasien' });
    await expect(identity.getByText('Siti Rahmawati')).toBeVisible();
    await expect(identity.getByText('NIK cocok dengan Dukcapil dan SATUSEHAT')).toBeVisible();

    const primary = page.getByRole('button', { name: 'Terbitkan SEP dan daftarkan', exact: true });
    await expect(primary).toBeDisabled();
    await expect(page.getByText('Cek kepesertaan BPJS dulu.')).toBeVisible();
    const expired = page.getByRole('button', { name: /Klinik Pratama Sehat Sentosa/ });
    await expect(expired).toBeDisabled();
    await expect(expired).toContainText('Kedaluwarsa');

    await page.getByRole('button', { name: 'Cek kepesertaan', exact: true }).click();
    await expect(page.getByText('AKTIF', { exact: true })).toBeVisible();
    await expect(page.getByText('Pilih rujukan aktif dulu.')).toBeVisible();
    await expect(expired).toBeDisabled();

    await page.getByRole('button', { name: /Surat kontrol · Poli Penyakit Dalam/ }).click();
    const dx = page.getByLabel('Diagnosa awal (ICD-10)');
    await expect(dx).toHaveValue('I10 · Hipertensi esensial (primer)');
    await dx.fill('');
    await expect(page.getByText('Isi diagnosa awal dulu.')).toBeVisible();
    await expect(page.getByText('Diagnosa awal wajib diisi untuk SEP (kode ICD-10).')).toBeVisible();
    await dx.fill('hipertensi');
    await expect(page.getByText('Periksa kode ICD-10 diagnosa awal.')).toBeVisible();
    await dx.fill('I10 · Hipertensi esensial (primer)');
    await expect(primary).toBeEnabled();
    await primary.click();
    await expect(page.getByText(/SEP 0301R0011026V000812 terbit pukul \d{2}\.\d{2}/)).toBeVisible();

    await page.getByRole('button', { name: 'Pakai jadwal ini dan bentuk antrean' }).click();
    const finish = page.getByRole('button', { name: 'Kirim antrean dan selesaikan' });
    await expect(finish).toBeDisabled();
    await expect(page.getByText('Persetujuan umum belum ditandatangani pasien.')).toBeVisible();
    await page.getByLabel(/Persetujuan umum \(general consent\)/).check();
    await finish.click();
    await expect(
      page.getByText(/Terdaftar pukul \d{2}\.\d{2} · antrean PD-028 · SEP 0301R0011026V000812/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cetak tiket, SEP, dan gelang' }).click();
    await expect(page.getByRole('button', { name: /Tercetak \d{2}\.\d{2} · cetak ulang/ })).toBeVisible();
    await expect(steps.locator('li').last()).toContainText(/Terdaftar \d{2}\.\d{2}/);
    await noHorizontalOverflow(page);
  });

  test('kuota JKN penuh: dokter tidak bisa dipilih pasien BPJS', async ({ page }) => {
    const petugas = await createAccount({ roles: ['petugas_pendaftaran'] });
    await loginAs(page, petugas, '/pendaftaran');
    await page.goto('/pendaftaran');
    await page.getByLabel('Poli tujuan').selectOption('JT');
    const bagus = page
      .getByRole('region', { name: 'Kuota dokter hari ini' })
      .getByRole('button', { name: /dr\. Bagus Santoso/ });
    await expect(bagus).toBeDisabled();
    await expect(bagus).toContainText('Kuota JKN penuh');
    await expect(page.getByRole('option', { name: /dr\. Bagus Santoso.*kuota penuh/ })).toBeDisabled();
    await noHorizontalOverflow(page);
  });
});

test('jadwal dokter: pilih slot, ubah kuota (tidak di bawah booking), kirim ke HFIS', async ({ page }) => {
  const petugas = await createAccount({ roles: ['petugas_pendaftaran'] });
  await loginAs(page, petugas, '/jadwal');
  await page.goto('/jadwal');
  await expect(page.getByRole('heading', { name: 'Jadwal praktik · 5–10 Okt 2026', level: 1 })).toBeVisible();
  const grid = page.getByRole('region', { name: 'Grid jadwal' });
  await expect(
    grid.getByRole('button', { name: /^dr\. Bagus Santoso, Sp\.JP, Rabu 7 Okt, Cuti/ }),
  ).toContainText('HFIS belum diubah');
  await expect(page.getByText(/Sinkron HFIS 07\.30 · 1 perbedaan/)).toBeVisible();

  await grid
    .getByRole('button', { name: /^dr\. Andini Prameswari, Sp\.PD, Senin 5 Okt, 07\.30–12, 22\/30/ })
    .click();
  const detail = page.getByRole('region', { name: 'Detail slot jadwal' });
  await expect(detail.getByText('Praktik · kuota tersedia')).toBeVisible();
  await expect(detail.getByText('22 pasien booking dari 30 kuota · 73% terisi')).toBeVisible();
  // ID sel jadwal = UUID deterministik dokter × tanggal (kontrak `scheduleSlotSchema`).
  await expect(page).toHaveURL(new RegExp(`pilih=${scheduleCellId(DOCTOR_ID.andini, '2026-10-05')}`));

  await detail.getByRole('button', { name: 'Tambah kuota JKN' }).click();
  await expect(detail.getByText('22 pasien booking dari 31 kuota · 71% terisi')).toBeVisible();
  await expect(detail.getByText('Perubahan kuota belum dikirim ke HFIS.')).toBeVisible();
  await expect(page.getByText(/Sinkron HFIS 07\.30 · 2 perbedaan/)).toBeVisible();

  const minusNon = detail.getByRole('button', { name: 'Kurangi kuota non-JKN' });
  await minusNon.click();
  await expect(minusNon).toBeDisabled();
  await expect(
    detail.getByText('Kuota non-JKN tidak bisa di bawah jumlah pasien non-JKN yang sudah booking (5).'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Perbarui jadwal ke HFIS' }).click();
  await expect(
    page.getByText(/Jadwal terkirim ke HFIS \(1 perubahan kuota\) · \d{2}\.\d{2} \(simulasi/),
  ).toBeVisible();
  await expect(page.getByRole('status', { name: 'Sinkron HFIS' })).toContainText('Tersinkron dengan HFIS');
  await expect(grid.getByRole('button', { name: /Rabu 7 Okt, Cuti/ })).toContainText('HFIS diperbarui');
  await expect(detail.getByText('Perubahan kuota belum dikirim ke HFIS.')).toHaveCount(0);

  // ≥ 80% "hampir penuh"; kuota diturunkan sampai habis (100%) → "Kuota penuh" di chip dan label sel.
  await grid
    .getByRole('button', { name: /^dr\. Bagus Santoso, Sp\.JP, Senin 5 Okt, 09–12, 18\/20,/ })
    .click();
  await expect(detail.getByText('Kuota hampir penuh', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Kurangi kuota non-JKN' }).click();
  await detail.getByRole('button', { name: 'Kurangi kuota non-JKN' }).click();
  await expect(detail.getByText('Kuota penuh', { exact: true })).toBeVisible();
  await expect(
    grid.getByRole('button', { name: 'dr. Bagus Santoso, Sp.JP, Senin 5 Okt, 09–12, 18/18, Kuota penuh' }),
  ).toBeVisible();

  await page.getByLabel('Poli').selectOption('Saraf');
  await expect(grid.getByRole('button', { name: /dr\. Andini/ })).toHaveCount(0);
  await expect(grid.getByRole('button', { name: /^dr\. Yudha Pratama/ }).first()).toBeVisible();
  await noHorizontalOverflow(page);
});

test('anjungan: keypad kode booking → biometrik → konfirmasi → tiket (lokal dan skenario)', async ({
  page,
}) => {
  const petugas = await createAccount({ roles: ['petugas_pendaftaran'] });
  await loginAs(page, petugas, '/kiosk');
  await page.goto('/kiosk');
  const kiosk = page.getByRole('region', { name: 'Anjungan pendaftaran mandiri' });
  await expect(kiosk.getByText('Senin, 5 Oktober 2026')).toBeVisible();
  const hint = page.getByRole('complementary', { name: 'Petunjuk presenter' });
  await expect(hint).toContainText('2610050117');

  const typeCode = async (code: string) => {
    await kiosk.getByRole('button', { name: /Saya sudah punya booking/ }).click();
    await kiosk.getByRole('button', { name: /^Kode booking/ }).click();
    await expect(kiosk.getByRole('heading', { name: 'Masukkan Kode booking' })).toBeVisible();
    for (const d of code) await kiosk.getByRole('button', { name: `Angka ${d}`, exact: true }).click();
    await expect(kiosk.getByText('Lengkap. Sentuh Lanjut.')).toBeVisible();
    await kiosk.getByRole('button', { name: 'Lanjut', exact: true }).click();
  };

  // Lokal: kode lain → Siti Rahmawati, tiket A-032 (setelah antrean loket A-028–A-030 dan A-031 Tn. Suryo).
  await kiosk.getByRole('button', { name: 'Huruf lebih besar' }).click();
  await expect(kiosk.getByRole('button', { name: 'Huruf lebih besar' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await kiosk.getByRole('button', { name: /Saya sudah punya booking/ }).click();
  await kiosk.getByRole('button', { name: /^Kode booking/ }).click();
  await kiosk.getByRole('button', { name: 'Angka 1', exact: true }).click();
  await kiosk.getByRole('button', { name: 'Angka 2', exact: true }).click();
  await expect(kiosk.getByText('Kurang 8 digit lagi')).toBeVisible();
  await expect(kiosk.getByRole('button', { name: 'Lanjut', exact: true })).toBeDisabled();
  await kiosk.getByRole('button', { name: 'Hapus satu angka terakhir' }).click();
  await kiosk.getByRole('button', { name: 'Kosongkan semua angka' }).click();
  await expect(kiosk.getByText('10 digit diperlukan')).toBeVisible();
  await kiosk.getByRole('button', { name: 'Kembali' }).click();
  await kiosk.getByRole('button', { name: 'Kembali' }).click();
  await typeCode('1234567890');
  await kiosk.getByRole('button', { name: /Pengenalan wajah/ }).click();
  await expect(kiosk.getByRole('heading', { name: 'Apakah ini data Anda?' })).toBeVisible();
  await expect(kiosk.getByText('Siti Rahmawati')).toBeVisible();
  await kiosk.getByRole('button', { name: 'Ya, data saya benar · cetak tiket' }).click();
  await expect(kiosk.getByRole('region', { name: 'Tiket antrean' })).toContainText('A-032');
  await kiosk.getByRole('button', { name: 'Selesai' }).click();

  // Skenario: kode booking Tn. Suryo menjalankan tugas scan → bio → tiket (A-031).
  await typeCode('2610050117');
  await kiosk.getByRole('button', { name: /Sidik jari/ }).click();
  await expect(kiosk.getByText('Tn. Suryo Adi Nugroho')).toBeVisible();
  await expect(kiosk.getByText('Sidik jari cocok')).toBeVisible();
  await kiosk.getByRole('button', { name: 'Ya, data saya benar · cetak tiket' }).click();
  await expect(kiosk.getByRole('region', { name: 'Tiket antrean' })).toContainText('A-031');
  await expect(hint).toContainText('sudah check-in');

  await kiosk.getByRole('button', { name: 'Panggil petugas' }).click();
  await expect(kiosk.getByText(/Petugas dipanggil pukul \d{2}\.\d{2}/)).toBeVisible();
});

test('display antrean: SEDANG DIPANGGIL, jeda, panggil manual', async ({ page }) => {
  const petugas = await createAccount({ roles: ['petugas_pendaftaran'] });
  await loginAs(page, petugas, '/display/antrean');
  await page.goto('/display/antrean');
  const calling = page.getByRole('region', { name: 'Sedang dipanggil' });
  await expect(calling).toContainText('SEDANG DIPANGGIL');
  await expect(calling).toContainText(/PD-025|JT-010/);
  const clinics = page.getByRole('region', { name: 'Antrean per poli' });
  await expect(clinics.getByRole('group', { name: 'Poli Saraf' })).toContainText(
    'Dokter mulai praktik 09.30',
  );
  await page.getByRole('button', { name: 'Jeda' }).click();
  await expect(page.getByText('Panggilan otomatis dijeda')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lanjut' })).toHaveAttribute('aria-pressed', 'true');
  const before = await calling.textContent();
  await page.getByRole('button', { name: 'Panggil berikutnya' }).click();
  await expect(calling).not.toHaveText(before ?? '');
  await expect(calling.getByLabel('Panggilan sebelumnya')).toContainText(/[A-Z]{2}-\d{3}/);
});

test('skenario rawat jalan: anjungan → panggil A-031 → cek → SEP → PD-027 di papan antrean', async ({
  page,
}) => {
  const petugas = await createAccount({ roles: ['petugas_pendaftaran'] });
  await loginAs(page, petugas, '/kiosk');
  await page.goto('/kiosk');
  const kiosk = page.getByRole('region', { name: 'Anjungan pendaftaran mandiri' });
  await kiosk.getByRole('button', { name: /Saya sudah punya booking/ }).click();
  await kiosk.getByRole('button', { name: /^Kode booking/ }).click();
  for (const d of '2610050117') await kiosk.getByRole('button', { name: `Angka ${d}`, exact: true }).click();
  await kiosk.getByRole('button', { name: 'Lanjut', exact: true }).click();
  await kiosk.getByRole('button', { name: /Pengenalan wajah/ }).click();
  await kiosk.getByRole('button', { name: 'Ya, data saya benar · cetak tiket' }).click();
  await expect(kiosk.getByRole('region', { name: 'Tiket antrean' })).toContainText('A-031');

  await page.goto('/pendaftaran');
  await page.getByRole('button', { name: 'Panggil berikutnya · A-031', exact: true }).click();
  const identity = page.getByRole('region', { name: 'Identitas pasien' });
  await expect(identity.getByText('Tn. Suryo Adi Nugroho')).toBeVisible();
  await page.getByRole('button', { name: 'Cek kepesertaan', exact: true }).click();
  await expect(page.getByText('AKTIF', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Surat kontrol · Poli Penyakit Dalam/ }).click();
  await expect(page.getByLabel('Diagnosa awal (ICD-10)')).toHaveValue(
    'E11.9 · Diabetes melitus tipe 2 tanpa komplikasi',
  );
  await page.getByRole('button', { name: 'Terbitkan SEP dan daftarkan', exact: true }).click();
  await expect(page.getByText(/SEP 0301R0011026V005102 terbit pukul \d{2}\.\d{2}/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Antrean poli' })).toContainText('PD-027');

  await page.goto('/display/antrean');
  await page.getByRole('button', { name: 'Jeda' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Antrean per poli' })
      .getByRole('group', { name: 'Poli Penyakit Dalam' }),
  ).toContainText('PD-027');
});
