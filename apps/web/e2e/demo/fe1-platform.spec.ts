import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/**
 * FE1 · Layar demo platform fase 1–2 dan operasional fase 10 (mode presentasi, ADR-0023): alur utama tiap layar
 * diklik sampai umpan balik berjam muncul. Tidak ada yang disimpan; tiap tes memakai akun baru.
 */

async function expectNoHorizontalOverflow(page: Page) {
  const { overflow, offenders } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > width + 0.5)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120));
    return { overflow: document.documentElement.scrollWidth - width, offenders };
  });
  expect(overflow, `scroll horizontal oleh: ${offenders.join(' | ')}`).toBeLessThanOrEqual(0);
}

const JAM = /\d{2}\.\d{2}/;

test.describe('FE1 · platform dan operasional', () => {
  test('struktur RS: telusur ke kamar, tambah kamar berkelas, nonaktifkan berkonfirmasi + alasan', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/struktur');
    await expect(
      page.getByRole('heading', { name: 'Struktur RS · faskes sampai bed', level: 1 }),
    ).toBeVisible();

    // Bangsal Melati terpilih: tidak bisa dinonaktifkan karena bed terisi (alasan tertulis).
    const detail = page.getByRole('region', { name: 'Unit · Bangsal Melati' });
    await expect(detail.getByRole('button', { name: 'Nonaktifkan' })).toBeDisabled();
    await expect(detail.getByText(/10 bed masih terisi pasien/)).toBeVisible();

    await detail.getByRole('button', { name: 'Buka Melati lantai 3' }).click();
    const ruang = page.getByRole('region', { name: 'Ruang · Melati lantai 3' });
    await ruang.getByRole('button', { name: 'Tambah kamar' }).click();
    const form = ruang.getByRole('form', { name: 'Tambah kamar di Melati lantai 3' });
    await form.getByLabel('Kode').fill('M-214');
    await form.getByLabel('Nama').fill('Kamar M-214');
    await form.getByLabel('Kelas rawat *').selectOption('');
    await form.getByRole('button', { name: 'Simpan kamar' }).click();
    await expect(form.getByText('Kamar rawat inap wajib punya kelas rawat')).toBeVisible();
    await form.getByLabel('Kelas rawat *').selectOption('kelas_2');
    await form.getByRole('button', { name: 'Simpan kamar' }).click();
    await expect(ruang.getByRole('status')).toContainText(/Kamar M-214 ditambahkan · \d{2}\.\d{2}/);
    await expect(ruang.getByRole('cell', { name: 'M-214', exact: true })).toBeVisible();

    // Kamar kosong M-212: nonaktifkan dengan alasan wajib.
    await ruang.getByRole('button', { name: 'Buka Kamar M-212' }).click();
    const kamar = page.getByRole('region', { name: 'Kamar · Kamar M-212' });
    await kamar.getByRole('button', { name: 'Nonaktifkan' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Nonaktifkan kamar Kamar M-212?' });
    const yes = dialog.getByRole('button', { name: 'Ya, nonaktifkan' });
    await expect(yes).toBeDisabled();
    await dialog.getByLabel('Alasan menonaktifkan').fill('Renovasi kamar mandi sampai 20 Okt');
    await yes.click();
    await expect(kamar.getByRole('status')).toContainText(JAM);
    await expect(kamar.getByRole('button', { name: 'Aktifkan kembali' })).toBeEnabled();
    await expect(page.getByRole('list', { name: 'Riwayat perubahan struktur' })).toContainText(
      'Renovasi kamar mandi sampai 20 Okt',
    );
    await expectNoHorizontalOverflow(page);
  });

  test('pengaturan RS: modul bergerbang dependensi, pengaturan tervalidasi, template terbit versi baru', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/pengaturan');
    await expect(
      page.getByRole('heading', { name: 'Pengaturan RS · modul, aturan, dan template cetak', level: 1 }),
    ).toBeVisible();

    // Modul: Lab dipakai modul lain (terkunci beralasan); Gizi dimatikan, Bank darah dinyalakan, lalu disimpan.
    const lab = page.getByRole('switch', { name: 'S01 Laboratorium patologi klinik' });
    await expect(lab).toBeDisabled();
    await expect(page.getByText(/Dipakai modul aktif .*S02/)).toBeVisible();
    await page.getByRole('switch', { name: 'S07 Gizi' }).click();
    await page.getByRole('switch', { name: 'S08 Bank darah' }).click();
    const pendingBar = page.getByRole('region', { name: 'Perubahan belum disimpan' });
    await expect(pendingBar).toContainText('2 perubahan belum disimpan: S07 → mati, S08 → aktif');
    await pendingBar.getByRole('button', { name: 'Simpan perubahan' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Simpan 2 perubahan modul?' });
    await dialog.getByLabel('Alasan perubahan').fill('Bank darah mulai memakai SIM RS 12 Okt');
    await dialog.getByRole('button', { name: 'Ya, simpan' }).click();
    await expect(pendingBar.getByRole('status')).toContainText(/Tersimpan · \d{2}\.\d{2} · 2 modul berubah/);

    // Pengaturan umum: nilai di luar batas skema ditolak, lalu disimpan.
    await page.getByRole('tab', { name: 'Pengaturan umum' }).click();
    const umum = page.getByRole('form', { name: 'Pengaturan umum' });
    const idle = umum.getByLabel('Batas sesi idle (menit)');
    await idle.fill('90');
    await expect(umum.getByText('Maksimal 60')).toBeVisible();
    await expect(umum.getByRole('button', { name: 'Simpan pengaturan' })).toBeDisabled();
    await idle.fill('20');
    await umum.getByRole('button', { name: 'Simpan pengaturan' }).click();
    await expect(umum.getByRole('status')).toContainText(/Tersimpan · \d{2}\.\d{2} · 1 pengaturan berubah/);

    // Template cetak: gelang tanpa alergi diblok; kop diubah lalu terbit versi 5.
    await page.getByRole('tab', { name: 'Template cetak' }).click();
    const editor = page.getByRole('region', { name: 'Ubah Gelang pasien dewasa' });
    await editor.getByLabel('Penanda alergi').uncheck();
    await expect(editor.getByText('Gelang pasien wajib menampilkan penanda alergi.')).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Terbitkan versi 5' })).toBeDisabled();
    await editor.getByLabel('Penanda alergi').check();
    await editor.getByLabel('Catatan kaki').fill('Gelang jangan dilepas selama dirawat');
    await expect(page.getByRole('img', { name: 'Pratinjau Gelang pasien dewasa (draf)' })).toContainText(
      'ALERGI: Amoksisilin',
    );
    await editor.getByRole('button', { name: 'Terbitkan versi 5' }).click();
    const publish = page.getByRole('alertdialog', { name: 'Terbitkan Gelang pasien dewasa versi 5?' });
    await publish.getByLabel('Catatan perubahan').fill('Catatan kaki gelang ditambahkan');
    await publish.getByRole('button', { name: 'Terbitkan versi 5' }).click();
    await expect(
      page.getByRole('region', { name: 'Ubah Gelang pasien dewasa' }).getByRole('status'),
    ).toContainText(/Versi 5 terbit · \d{2}\.\d{2}/);
    await expectNoHorizontalOverflow(page);
  });

  test('data rujukan: cari tahan salah ketik, impor CSV uji kering gagal tertutup lalu terapkan', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/terminologi');
    await expect(
      page.getByRole('heading', { name: 'Data rujukan · kode baku dan impor versi', level: 1 }),
    ).toBeVisible();

    const results = page.getByRole('list', { name: 'Hasil pencarian kode' });
    await expect(results).toContainText('J18.9');
    await expect(results).toContainText('ejaan mirip');
    await page.getByLabel('Kode atau kata kunci').fill('troponin');
    await page.getByRole('radio', { name: 'LOINC' }).click();
    await expect(page.getByText('Tidak ada kode yang cocok.')).toBeVisible();

    await page.getByRole('tab', { name: 'Impor CSV' }).click();
    await page.getByRole('button', { name: /loinc-2\.77-lab-rsfa\.csv/ }).click();
    await page.getByRole('button', { name: 'Jalankan uji kering' }).click();
    await expect(page.getByRole('list', { name: 'Galat impor' })).toContainText(
      'kode 2823-3 muncul lebih dari sekali',
    );
    await expect(page.getByRole('button', { name: 'Terapkan impor' })).toBeDisabled();

    await page.getByRole('button', { name: /loinc-2\.77-lab-rsfa-perbaikan\.csv/ }).click();
    await page.getByRole('button', { name: 'Jalankan uji kering' }).click();
    const summary = page.getByRole('region', { name: 'Ringkasan uji kering' });
    await expect(summary.getByText('Kode baru')).toBeVisible();
    await page.getByRole('button', { name: 'Terapkan impor' }).click();
    await page
      .getByRole('alertdialog', { name: 'Terapkan loinc-2.77-lab-rsfa-perbaikan.csv?' })
      .getByRole('button', { name: 'Ya, terapkan' })
      .click();
    await expect(page.getByText(/Diterapkan · \d{2}\.\d{2} · LOINC versi 2\.77-contoh/)).toBeVisible();

    await page.getByRole('tab', { name: 'Cari kode' }).click();
    await expect(results).toContainText('10839-9');
    await page.getByRole('tab', { name: 'Riwayat versi' }).click();
    await expect(page.getByRole('region', { name: 'Riwayat versi data rujukan' })).toContainText(
      'Anda (sesi ini)',
    );
    await expectNoHorizontalOverflow(page);
  });

  test('dokumen & TTE: kirim ulang TTE gagal sampai QR verifikasi, unggah tervalidasi, batal beralasan', async ({
    page,
  }) => {
    const rm = await createAccount({ roles: ['petugas_rm'] });
    await loginAs(page, rm, '/rekam-medis/dokumen');
    await expect(
      page.getByRole('heading', { name: 'Dokumen pasien dan tanda tangan elektronik', level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel('Identitas pasien')).toContainText('Amoksisilin');

    const list = page.getByRole('list', { name: 'Daftar dokumen' });
    await list.getByRole('button', { name: /Surat kontrol pasca rawat inap/ }).click();
    const detail = page.getByRole('region', { name: /^Surat kontrol pasca rawat inap/ });
    await expect(detail.getByRole('alert')).toContainText('Penyelenggara TTE tidak menjawab');
    await detail.getByRole('button', { name: 'Kirim ulang permintaan TTE' }).click();
    await detail.getByRole('button', { name: /^Setujui sebagai dr\. Andini/ }).click();
    await expect(detail.getByText(/^Ditandatangani dr\. Andini.* · \d{2}\.\d{2}$/)).toBeVisible();
    await expect(detail.getByText('Terkunci', { exact: true })).toBeVisible();
    const verify = page.getByRole('region', { name: 'Pratinjau halaman verifikasi' });
    await expect(verify).toContainText('Dokumen asli · tanda tangan sah');
    await expect(verify).toContainText('Ny. E***** W*****');
    await page.getByLabel('Uji dengan berkas yang sudah diubah (hash berbeda)').check();
    await expect(verify).toContainText('Tidak cocok');

    await page.getByRole('button', { name: 'Unggah dokumen' }).click();
    const form = page.getByRole('form', { name: 'Unggah dokumen' });
    await form.getByLabel('Jenis dokumen').selectOption('hasil');
    await form.getByLabel('Judul').fill('Hasil spirometri');
    const fileInput = form.getByLabel('Berkas (PDF, PNG, JPEG · maks. 10 MB)');
    await fileInput.setInputFiles({
      name: 'catatan.docx',
      mimeType: 'application/msword',
      buffer: Buffer.from('x'),
    });
    await form.getByRole('button', { name: 'Simpan dokumen' }).click();
    await expect(form.getByText(/Jenis berkas ditolak/)).toBeVisible();
    await fileInput.setInputFiles({
      name: 'spirometri.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 contoh fiktif'),
    });
    await expect(form.getByText(/spirometri\.pdf · \d+ B · SHA-256/)).toBeVisible();
    await form.getByRole('button', { name: 'Simpan dokumen' }).click();
    const fresh = page.getByRole('region', { name: /^Hasil spirometri/ });
    await expect(fresh.getByRole('status')).toContainText(/Tersimpan · \d{2}\.\d{2} · SHA-256/);
    await fresh.getByRole('button', { name: 'Batalkan dokumen' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Batalkan Hasil spirometri?' });
    await dialog.getByLabel('Alasan pembatalan').fill('Berkas terunggah ke RM yang salah');
    await dialog.getByRole('button', { name: 'Ya, batalkan dokumen' }).click();
    await expect(fresh.getByRole('status')).toContainText('Dibatalkan: Hasil spirometri');
    await expectNoHorizontalOverflow(page);
  });

  test('penjadwal: job gagal dijalankan ulang berkonfirmasi, job berisiko wajib alasan, jeda beralasan', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/penjadwal');
    await expect(
      page.getByRole('heading', { name: 'Penjadwal pekerjaan · job berkala', level: 1 }),
    ).toBeVisible();
    const summary = page.getByRole('region', { name: 'Ringkasan job' });
    await expect(summary).toContainText('Gagal saat ini');

    const detail = page.getByRole('region', { name: 'Sinkron ketersediaan bed ke Aplicare' });
    await expect(detail.getByRole('alert')).toContainText('Aplicare menjawab 503');
    await detail.getByRole('button', { name: 'Jalankan ulang' }).click();
    await page
      .getByRole('alertdialog', { name: 'Jalankan Sinkron ketersediaan bed ke Aplicare sekarang?' })
      .getByRole('button', { name: 'Ya, jalankan' })
      .click();
    await expect(detail.getByRole('status')).toContainText(/selesai · \d{2}\.\d{2} · berhasil/);
    await expect(detail.getByRole('list', { name: /^Riwayat jalan/ })).toContainText('Aplicare pulih');

    await page.getByRole('button', { name: 'Detail Laporan RL/SIRS Online bulanan' }).click();
    const rl = page.getByRole('region', { name: 'Laporan RL/SIRS Online bulanan' });
    await rl.getByRole('button', { name: 'Jalankan ulang' }).click();
    const dialog = page.getByRole('alertdialog', { name: /^Jalankan Laporan RL/ });
    await expect(dialog.getByRole('button', { name: 'Ya, jalankan' })).toBeDisabled();
    await dialog.getByLabel('Alasan menjalankan manual').fill('Koreksi koding RL 3.1 selesai');
    await dialog.getByRole('button', { name: 'Ya, jalankan' }).click();
    await expect(rl.getByRole('status')).toContainText(/selesai · \d{2}\.\d{2}/);

    await page.getByRole('button', { name: 'Detail Pengingat jadwal kontrol pasien (WhatsApp)' }).click();
    const wa = page.getByRole('region', { name: 'Pengingat jadwal kontrol pasien (WhatsApp)' });
    await expect(wa.getByRole('button', { name: 'Jalankan sekarang' })).toBeDisabled();
    await expect(wa.getByText('Job dijeda; lanjutkan dulu sebelum menjalankan.')).toBeVisible();
    await wa.getByRole('button', { name: 'Lanjutkan' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Ya, lanjutkan' }).click();
    await expect(wa.getByRole('status')).toContainText(/dilanjutkan · \d{2}\.\d{2}/);
    await expectNoHorizontalOverflow(page);
  });

  test('rujukan: surat kontrol terbit, SPRI ditolak diperbaiki lalu terbit, rujukan internal dibatalkan', async ({
    page,
  }) => {
    const petugas = await createAccount({ roles: ['petugas_pendaftaran'] });
    await loginAs(page, petugas, '/rujukan');
    await expect(
      page.getByRole('heading', { name: 'Rujukan, surat kontrol, dan SPRI', level: 1 }),
    ).toBeVisible();

    const list = page.getByRole('list', { name: 'Daftar rujukan' });
    await list.getByRole('button', { name: /Surat kontrol · Ny\. Endang Wijaya/ }).click();
    const kontrol = page.getByRole('region', { name: 'Surat kontrol · Ny. Endang Wijaya' });
    await kontrol.getByRole('button', { name: 'Proses antrean kirim (simulasi)' }).click();
    await expect(kontrol.getByRole('status')).toContainText(
      /Nomor BPJS terbit 0301R0011025K000045 · \d{2}\.\d{2}/,
    );

    await page
      .getByRole('group', { name: 'Saring rujukan' })
      .getByRole('button', { name: /^Bermasalah/ })
      .click();
    await list
      .getByRole('button', { name: /Surat perintah rawat inap \(SPRI\) · Tn\. Yusuf Hidayat/ })
      .click();
    const spri = page.getByRole('region', { name: 'Surat perintah rawat inap (SPRI) · Tn. Yusuf Hidayat' });
    await expect(spri.getByRole('alert')).toContainText('BPJS_TANGGAL_TIDAK_VALID');
    const fix = spri.getByRole('button', { name: 'Perbaiki & kirim ulang' });
    await expect(fix).toBeDisabled();
    await expect(spri.getByText('Pilih tanggal rencana baru dulu.')).toBeVisible();
    await spri.getByLabel('Tanggal rencana baru').selectOption('2026-10-06');
    await fix.click();
    await spri.getByRole('button', { name: 'Proses antrean kirim (simulasi)' }).click();
    await expect(spri.getByRole('status')).toContainText('Nomor BPJS terbit 0301R0011025S000019');

    await page
      .getByRole('group', { name: 'Saring rujukan' })
      .getByRole('button', { name: 'Internal antarpoli' })
      .click();
    await list.getByRole('button', { name: /Rujukan internal antarpoli/ }).click();
    const internal = page.getByRole('region', { name: /^Rujukan internal antarpoli/ });
    await internal.getByRole('button', { name: 'Batalkan' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel('Alasan pembatalan').fill('Pasien menolak konsul hari ini');
    await dialog.getByRole('button', { name: 'Ya, batalkan' }).click();
    await expect(internal.getByRole('status')).toContainText(/dibatalkan · \d{2}\.\d{2}/);
    await expectNoHorizontalOverflow(page);
  });

  test('info publik: jadwal + sisa kuota, antrean nomor saja, cek booking tanpa nama dan bergerbang percobaan', async ({
    page,
  }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/pratinjau/info-publik');
    await expect(page.getByRole('region', { name: 'Pratinjau info publik' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Jadwal dokter hari ini' })).toContainText(
      /JKN (sisa \d+|penuh)/,
    );

    await page.getByRole('tab', { name: 'Antrean' }).click();
    await expect(page.getByRole('list', { name: 'Antrean berjalan' })).toContainText('Poli Penyakit Dalam');

    await page.getByRole('tab', { name: 'Cek booking' }).click();
    const form = page.getByRole('form', { name: 'Cek status booking' });
    await form.getByLabel('Tanggal lahir pasien').fill('1979-01-26');
    await form.getByRole('button', { name: 'Cek status' }).click();
    await expect(form.getByRole('alert')).toContainText('Sisa 4 percobaan');
    await form.getByLabel('Tanggal lahir pasien').fill('1979-01-25');
    await form.getByRole('button', { name: 'Cek status' }).click();
    const status = form.getByRole('region', { name: 'Status booking' });
    await expect(status).toContainText('Nomor Anda PD-026');
    await expect(status).toContainText(/Dicek · \d{2}\.\d{2}/);
    await expect(status).not.toContainText('Darmawan');
  });

  test('downtime: aktifkan beralasan, cetak paket wajib, entri susulan, sinkron sampai nol, ringkasan insiden', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/downtime');
    await expect(
      page.getByRole('heading', { name: 'Mode downtime dan sinkron edge', level: 1 }),
    ).toBeVisible();

    const activate = page.getByRole('button', { name: 'Aktifkan mode downtime' });
    await expect(activate).toBeDisabled();
    await page
      .getByLabel('Alasan dan dampak (tercatat di log insiden)')
      .fill('VClaim timeout sejak 10.40, SEP tidak terbit');
    await activate.click();
    await page
      .getByRole('alertdialog', { name: 'Aktifkan mode downtime?' })
      .getByRole('button', { name: 'Ya, aktifkan' })
      .click();
    await expect(page.getByRole('alert').filter({ hasText: 'Mode downtime aktif sejak' })).toBeVisible();

    const recover = page.getByRole('button', { name: 'Layanan pulih · akhiri downtime' });
    await expect(recover).toBeDisabled();
    await expect(page.getByText('Cetak paket darurat dulu (langkah wajib SOP).')).toBeVisible();
    await page.getByRole('button', { name: 'Cetak paket darurat' }).click();
    await expect(page.getByText(/DICETAK \d{2}\.\d{2} OLEH/)).toBeVisible();
    await page.getByRole('button', { name: 'Daftarkan pasien (offline)' }).click();
    await page.getByRole('button', { name: 'Waktu berjalan 15 menit' }).click();
    await recover.click();
    await page
      .getByRole('alertdialog', { name: 'Nyatakan layanan pulih?' })
      .getByRole('button', { name: 'Ya, layanan pulih' })
      .click();

    const sync = page.getByRole('button', { name: 'Mulai sinkronisasi antrean' });
    await expect(sync).toBeDisabled();
    const enter = page.getByRole('button', { name: /^Masukkan/ });
    for (let left = 4; left > 0; left--) {
      await expect(enter).toHaveCount(left);
      await enter.first().click();
    }
    await expect(enter).toHaveCount(0);
    await sync.click();
    const batch = page.getByRole('button', { name: /^Kirim batch berikutnya/ });
    while (await batch.isVisible()) await batch.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Downtime selesai · antrean kirim kosong' }),
    ).toContainText('data hilang 0');
    await expect(page.getByRole('list', { name: 'Log insiden downtime' })).toContainText('Layanan pulih');
    await expectNoHorizontalOverflow(page);
  });

  test('cadangan: backup manual beralasan, uji restore gagal aman dengan kunci salah lalu lulus', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/cadangan');
    await expect(page.getByRole('heading', { name: 'Cadangan dan pemulihan', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ringkasan cadangan' })).toContainText('3/3');

    await page.getByRole('button', { name: 'Jalankan backup manual' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Jalankan backup manual sekarang?' });
    await dialog.getByLabel('Alasan backup manual').fill('Sebelum migrasi data tarif');
    await dialog.getByRole('button', { name: 'Ya, jalankan backup' }).click();
    await expect(page.getByText(/Backup manual selesai · \d{2}\.\d{2}/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Riwayat backup' })).toContainText(
      'Manual: Sebelum migrasi data tarif',
    );

    await page.getByLabel('Simulasikan kunci privat yang salah').check();
    await page.getByRole('button', { name: 'Mulai uji restore' }).click();
    for (const n of [2, 3]) await page.getByRole('button', { name: `Jalankan langkah ${n}` }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Uji restore gagal' })).toContainText(
      'sebelum ada plaintext',
    );
    await page.getByRole('button', { name: 'Ulang uji' }).click();
    await page.getByLabel('Simulasikan kunci privat yang salah').uncheck();
    await page.getByRole('button', { name: 'Mulai uji restore' }).click();
    for (let n = 2; n <= 8; n++) await page.getByRole('button', { name: `Jalankan langkah ${n}` }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Uji restore lulus' })).toContainText(
      'RTO 36 menit',
    );
    await expect(page.getByRole('region', { name: 'Jumlah baris manifest dan hasil pulih' })).toContainText(
      '1.284.551',
    );
    await expectNoHorizontalOverflow(page);
  });

  test('go-live: GO terkunci sampai item kritis selesai berpemilik, keputusan tercatat, matriks 51 EP tersaring', async ({
    page,
  }) => {
    const direksi = await createAccount({ roles: ['manajemen'] });
    await loginAs(page, direksi, '/sistem/go-live');
    await expect(
      page.getByRole('heading', { name: 'Kesiapan go-live · ceklis dan bukti MRMIK', level: 1 }),
    ).toBeVisible();
    const go = page.getByRole('button', { name: 'Putuskan GO' });
    await page
      .getByLabel('Catatan keputusan (wajib, tercatat)')
      .fill('Pilot mulai Senin 12 Okt, hypercare 2 minggu');
    await expect(go).toBeDisabled();
    await expect(
      page.getByText('Terkunci: 3 item kritis belum selesai atau belum berpemilik.'),
    ).toBeVisible();

    await page.getByRole('checkbox', { name: /Kunci cadangan dipegang dua orang terpisah/ }).check();
    await page.getByLabel('Pemilik: Kunci cadangan dipegang dua orang terpisah').selectOption('Direktur');
    await page.getByRole('checkbox', { name: /Dokter dan perawat terlatih CPPT/ }).check();
    await page.getByRole('checkbox', { name: /Kontak 24 jam BPJS/ }).check();
    await expect(go).toBeDisabled();
    await page.getByLabel(/^Pemilik: Kontak 24 jam BPJS/).selectOption('Kepala IT');
    await expect(go).toBeEnabled();
    await go.click();
    await page
      .getByRole('alertdialog', { name: 'Putuskan GO go-live?' })
      .getByRole('button', { name: 'Ya, putuskan GO' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: /Keputusan GO · \d{2}\.\d{2}/ })).toContainText(
      'Pilot mulai Senin 12 Okt',
    );

    await page.getByRole('tab', { name: 'Matriks 51 EP MRMIK' }).click();
    await expect(page.getByRole('region', { name: 'Ringkasan MRMIK' })).toContainText(
      '21 kunci · 16 pendukung · 14 tata kelola',
    );
    await page
      .getByRole('group', { name: 'Saring klasifikasi' })
      .getByRole('button', { name: 'Kunci' })
      .click();
    await page.getByRole('group', { name: 'Saring status' }).getByRole('button', { name: 'Belum' }).click();
    const matrix = page.getByRole('region', { name: 'Matriks 51 EP MRMIK' });
    await expect(matrix.getByRole('row')).toHaveCount(2);
    await expect(matrix).toContainText('MRMIK 10b');
    await expectNoHorizontalOverflow(page);
  });
});
