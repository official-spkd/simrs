import { expect, type Page, test } from '@playwright/test';
import { PERSONA } from '../../src/lib/demo/fixtures/staf';
import { type Account, createAccount, loginAs, submitPassword, totpFor, typeCode } from '../support/accounts';

/**
 * FE5 · Alur layar back office fase 8 dan kanal fase 9 di mode presentasi (ADR-0023): setiap layar dijalankan dari
 * keadaan awal sampai tugas utamanya selesai, termasuk gerbang beralasan. Sejak CX-3 setiap aksi tersimpan di toko
 * demo bersama (ADR-0085): tiap alur memeriksa bertahan (muat ulang) dan, bila ada, mengalir ke layar lain.
 */

/** Masuk dengan akun berposisi ganda lalu pilih posisi awal. */
async function loginWithPosition(page: Page, account: Account, roleName: string) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/masuk/);
  await submitPassword(page, account, account.password);
  await typeCode(page, totpFor(account.totpSecret as string));
  await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
  await expect(page.getByRole('heading', { name: 'Pilih posisi dan unit kerja' })).toBeVisible();
  await page.getByText(roleName, { exact: true }).click();
  await page.getByRole('button', { name: `Masuk sebagai ${roleName}` }).click();
  await expect(
    page.getByText(new RegExp(`Anda masuk sebagai\\s*${roleName.replace(/[()]/g, '\\$&')}`)),
  ).toBeVisible();
}

async function switchPosition(page: Page, roleName: string) {
  await page.getByRole('link', { name: 'Ganti posisi' }).first().click();
  await expect(page.getByRole('heading', { name: 'Ganti posisi', level: 1 })).toBeVisible();
  await page.getByText(roleName, { exact: true }).click();
  await page.getByRole('button', { name: `Pindah ke ${roleName}` }).click();
  await expect(
    page.getByText(new RegExp(`Anda masuk sebagai\\s*${roleName.replace(/[()]/g, '\\$&')}`)),
  ).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('FE5 · back office', () => {
  test('B09 RM administratif: hak subjek data berpemisahan tugas (sesi), peminjaman berkas, pemusnahan berurutan; bertahan', async ({
    page,
  }) => {
    const direksi = await createAccount({ roles: ['manajemen'], displayName: 'Direktur RM Fiktif' });
    await loginAs(page, direksi, '/');
    await page.goto('/rekam-medis/administrasi');
    await expect(page.getByRole('heading', { name: 'Rekam medis administratif', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ringkasan rekam medis administratif' })).toContainText(
      '1 lewat tenggat',
    );

    // Pelepasan ke asuransi: pengguna sesi memverifikasi → tidak bisa menyetujui sendiri (pemisahan tugas).
    const verify = page.getByRole('button', { name: 'Verifikasi selesai' });
    await expect(verify).toBeDisabled();
    await expect(page.getByText('Centang ketiga pemeriksaan dulu (0/3).')).toBeVisible();
    for (const box of await page.getByRole('checkbox').all()) await box.check();
    await verify.click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'identitas dan dasar diverifikasi oleh Direktur RM Fiktif' }),
    ).toBeVisible();
    const approve = page.getByRole('button', { name: 'Setujui pelepasan' });
    await expect(approve).toBeDisabled();
    await expect(page.getByText(/penyetuju harus pengguna lain/)).toBeVisible();
    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);
    // Bertahan setelah muat ulang (tahap + pemverifikasi dari sesi).
    await page.reload();
    await expect(page.getByRole('list', { name: 'Tahap ROI-2610-007' })).toContainText('Direktur RM Fiktif');
    await expect(approve).toBeDisabled();

    // Koreksi data yang sudah diverifikasi penerima loket: disetujui pengguna sesi → diterapkan sebagai versi baru.
    await page.getByRole('button', { name: /ROI-2610-009/ }).click();
    await page.getByRole('button', { name: 'Setujui koreksi' }).click();
    await page.getByRole('button', { name: 'Terapkan koreksi' }).click();
    await expect(page.getByText(/koreksi diterapkan sebagai versi baru/)).toBeVisible();
    await expect(page.getByRole('button', { name: /ROI-2610-009/ })).toContainText('Dipenuhi');

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

    // Pemusnahan: elektronik ditolak; usulan oleh pengguna sesi, penyetuju direktur harus pengguna lain.
    await page.getByRole('tab', { name: 'Retensi & pemusnahan' }).click();
    await expect(page.getByRole('button', { name: 'Musnahkan data elektronik' })).toBeDisabled();
    await page.getByRole('button', { name: 'Usulkan ke komite RM' }).click();
    await expect(page.getByRole('list', { name: 'Jejak persetujuan' })).toContainText('Direktur RM Fiktif');
    await expect(page.getByRole('button', { name: 'Setujui pemusnahan (direktur)' })).toBeDisabled();
    await expect(page.getByText(/Anda pengusul: penyetuju harus pengguna lain/)).toBeVisible();

    // Semua aksi bertahan setelah muat ulang.
    await page.reload();
    await page.getByRole('tab', { name: /Peminjaman berkas/ }).click();
    await expect(loans).toContainText('dr. Bagus Santoso, Sp.JP');
    await expect(loans.getByText('Terlambat 3 hari')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Retensi & pemusnahan' }).click();
    await expect(page.getByRole('list', { name: 'Jejak persetujuan' })).toContainText('Direktur RM Fiktif');

    await expectNoHorizontalOverflow(page);
  });
  test('K-1 → B09: pasien dinyatakan meninggal di IGD → SKK masuk arsip RM administratif', async ({
    page,
  }) => {
    const akun = await createAccount({ roles: ['dokter', 'petugas_rm'] });
    await loginWithPosition(page, akun, 'Dokter (DPJP)');
    await page.goto('/klinis/igd');
    const board = page.getByRole('region', { name: 'Papan pasien IGD' });
    await board.getByRole('button', { name: /Tn\. Ahmad Fauzi/ }).click();
    const disp = page.getByRole('region', { name: 'Disposisi pasien IGD' });
    await disp.getByRole('button', { name: 'Tangani sebagai dokter penanggung jawab' }).click();
    await expect(disp.getByRole('status')).toContainText('kini dokter penanggung jawab');
    await disp.getByRole('button', { name: 'Nyatakan meninggal' }).click();
    const form = disp.getByRole('form', { name: 'Pernyataan meninggal' });
    await form.getByLabel('Jam kematian (HH.MM)').fill('10.40');
    await form.getByLabel('Sebab kematian (ICD-10)').selectOption('I21.4');
    await form.getByLabel(/Tanda tangani surat keterangan kematian/).check();
    await form.getByRole('button', { name: 'Simpan pernyataan meninggal' }).click();
    await expect(page.getByRole('region', { name: 'Disposisi meninggal hari ini' })).toContainText(
      'Tn. Ahmad Fauzi',
    );

    await switchPosition(page, 'Petugas rekam medis');
    await page.goto('/rekam-medis/administrasi');
    await expect(page.getByRole('region', { name: 'Masuk dari layar klinis' })).toContainText(
      /Tn\. Ahmad Fauzi .* Meninggal · I21\.4 .* SKK\/RSFA\/0001 diarsip permanen/,
    );
  });

  test('B03 SDM: SIP kedaluwarsa diperbarui, NIK dibuka beralasan, pegawai keluar, jadwal dinas terbit (jeda + 40 jam); bertahan', async ({
    page,
  }) => {
    const direksi = await createAccount({ roles: ['manajemen'], displayName: 'Direktur SDM Fiktif' });
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
    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);

    // Bertahan setelah muat ulang: SIP baru dan status keluar atas nama pengguna sesi; NIK kembali tersamar.
    await page.reload();
    await page.getByRole('button', { name: 'Semua', exact: true }).click();
    await page.getByRole('button', { name: /dr\. Rina Kusuma/ }).click();
    await expect(page.getByText(/Pegawai keluar · .* oleh Direktur SDM Fiktif/)).toBeVisible();
    await expect(page.getByText('9999220200000005')).toHaveCount(0);

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
    await expect(roster.getByText(/1 jeda istirahat setelah dinas malam dilanggar/)).toBeVisible();
    await page.getByRole('button', { name: /^Pagi Jum 16/ }).click();
    await page.getByRole('button', { name: 'Lepas Ns. Maya Sari, S.Kep' }).click();
    await fill(/^Pagi Jum 16/, 'peg-0011');
    // > 40 jam per minggu kini memblokir terbit (dulu hanya warna).
    await expect(roster.getByText(/1 perawat melebihi 40 jam per minggu/)).toBeVisible();
    await expect(publish).toBeDisabled();
    await page.getByRole('button', { name: /^Pagi Rab 14/ }).click();
    await page.getByRole('button', { name: 'Lepas Ns. Fikri Ananda, S.Kep' }).click();
    await fill(/^Pagi Rab 14/, 'peg-0008');
    await publish.click();
    await expect(page.getByText(/terbit versi 1 · Sen, 5 Okt 2026/).first()).toBeVisible();

    await page.reload();
    await page.getByRole('tab', { name: 'Jadwal dinas' }).click();
    await expect(roster.getByText(/Terbit versi 1 · .* · Direktur SDM Fiktif/)).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });
  test('B04 kredensial: berkas susulan → telaah (Dokter) → komite oleh pengguna lain; bertahan; ditegakkan di CPOE', async ({
    page,
  }) => {
    const dokter = await createAccount({ roles: ['dokter'], displayName: 'dr. Mitra Bestari Fiktif' });
    await loginAs(page, dokter, '/');
    await page.goto('/manajemen/kredensial');
    await expect(
      page.getByRole('heading', { name: 'Kredensial dan kewenangan klinis', level: 1 }),
    ).toBeVisible();

    const forward = page.getByRole('button', { name: 'Berkas lengkap, teruskan ke mitra bestari' });
    await expect(forward).toBeDisabled();
    await expect(page.getByText(/Berkas belum lengkap: Sertifikat pelatihan biopsi ginjal/)).toBeVisible();
    await page.getByRole('checkbox', { name: /Sertifikat pelatihan biopsi ginjal/ }).check();
    await forward.click();
    await page.getByLabel('Pemasangan kateter dialisis femoral').selectOption('diberikan');
    await page.getByLabel('Biopsi ginjal perkutan').selectOption('supervisi');
    await page.getByLabel('Catatan mitra bestari').fill('Logbook 24 tindakan, observasi langsung memadai');
    await page.getByRole('button', { name: 'Kirim hasil telaah ke komite' }).click();
    await expect(page.getByText(/hasil telaah dikirim ke rapat komite/)).toBeVisible();
    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);
    // Rapat komite diputus pengguna lain dari penelaah (pemisahan tugas memakai pengguna sesi).
    const committee = page.getByRole('button', { name: 'Setujui rekomendasi komite' });
    await expect(committee).toBeDisabled();
    await expect(page.getByText(/Anda penelaah pengajuan ini/)).toBeVisible();

    await page.reload();
    await expect(page.getByRole('list', { name: 'Tahap KRD-2610-005' })).toContainText(
      'dr. Mitra Bestari Fiktif',
    );
    await expect(committee).toBeDisabled();

    const guard = page.getByRole('region', { name: 'Uji penegakan di CPOE' });
    await guard.getByLabel('Praktisi').selectOption('dr. Rina Kusuma');
    await guard.getByLabel('Tindakan yang dipesan').selectOption('Resusitasi jantung paru lanjut');
    await guard.getByRole('button', { name: 'Uji order' }).click();
    await expect(guard.getByRole('alert')).toContainText('LICENSE_EXPIRED');

    await page.getByRole('button', { name: /KRD-2610-006/ }).click();
    await expect(page.getByText(/SIP kedaluwarsa: perbarui dulu di SDM/)).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });

  test('B03 → B04: SIP baru di SDM mengalir ke verifikasi kredensial dan uji CPOE; RKK hanya direktur', async ({
    page,
  }) => {
    const direksi = await createAccount({ roles: ['manajemen'] });
    await loginAs(page, direksi, '/');
    await page.goto('/manajemen/kredensial');
    await page.getByRole('button', { name: /KRD-2610-006/ }).click();
    await expect(page.getByText(/SIP kedaluwarsa: perbarui dulu di SDM/)).toBeVisible();

    await page.goto('/manajemen/sdm');
    await page.getByRole('button', { name: /dr\. Rina Kusuma/ }).click();
    await page.getByLabel('Nomor SIP baru').fill('9999/UM/0533');
    await page.getByLabel('Berlaku sampai').fill('2031-10-05');
    await page.getByRole('button', { name: 'Simpan SIP baru' }).click();
    await expect(page.getByText(/SIP baru dr\. Rina Kusuma dicatat/)).toBeVisible();

    await page.goto('/manajemen/kredensial');
    await page.getByRole('button', { name: /KRD-2610-006/ }).click();
    await expect(page.getByText(/SIP kedaluwarsa: perbarui dulu di SDM/)).toHaveCount(0);
    const guard = page.getByRole('region', { name: 'Uji penegakan di CPOE' });
    await guard.getByLabel('Praktisi').selectOption('dr. Rina Kusuma');
    await guard.getByLabel('Tindakan yang dipesan').selectOption('Resusitasi jantung paru lanjut');
    await guard.getByRole('button', { name: 'Uji order' }).click();
    await expect(guard.getByText('LICENSE_EXPIRED')).toHaveCount(0);

    // Manajemen tidak menelaah sebagai mitra bestari (posisi Dokter).
    await page.getByRole('button', { name: /KRD-2610-004/ }).click();
    await expect(page.getByText('Telaah oleh mitra bestari (posisi Dokter).')).toBeVisible();
  });
  test('B07 PPI: konfirmasi suspek VAP, bukan HAI beralasan, sensus, 5 momen, bundle, isolasi airborne', async ({
    page,
  }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/');
    await page.goto('/manajemen/ppi');
    await expect(
      page.getByRole('heading', { name: 'Pencegahan dan pengendalian infeksi', level: 1 }),
    ).toBeVisible();

    const confirm = page.getByRole('button', { name: 'Konfirmasi HAI' });
    await expect(confirm).toBeDisabled();
    for (const box of await page
      .getByRole('tabpanel', { name: 'Surveilans HAIs' })
      .getByRole('checkbox')
      .all()) {
      await box.check();
    }
    await confirm.click();
    await expect(
      page.getByText(/dikonfirmasi .* \(di atas sasaran: audit bundle unit dijadwalkan\)/),
    ).toBeVisible();

    await page.getByRole('button', { name: /^Phlebitis/ }).click();
    await page.getByRole('button', { name: 'Bukan HAI…' }).click();
    await page.getByLabel(/Alasan/).fill('Kemerahan karena plester, skor VIP turun ke 0');
    await page.getByRole('button', { name: 'Simpan keputusan' }).click();
    await expect(page.getByText(/diputus bukan HAI/)).toBeVisible();

    for (const label of [
      'Pasien dengan kateter urine',
      'Pasien dengan ventilator',
      'Pasien dengan infus perifer',
      'Operasi bersih hari ini',
    ]) {
      await page.getByLabel(label).fill('4');
    }
    await page.getByRole('button', { name: 'Catat sensus hari ini' }).click();
    await expect(page.getByText(/Sensus hari ini tercatat/)).toBeVisible();

    await page.getByRole('tab', { name: 'Kebersihan tangan' }).click();
    await page.getByLabel('Profesi yang diamati').selectOption('Dokter');
    await page.getByLabel('Momen').selectOption('0');
    await page.getByLabel('Tindakan').selectOption('tidak');
    await page.getByRole('button', { name: 'Catat peluang' }).click();
    await expect(page.getByText(/kepatuhan bulan ini 88% \(352\/401\)/)).toBeVisible();

    await page.getByRole('tab', { name: 'Bundle' }).click();
    const bundle = page.getByRole('tabpanel', { name: 'Bundle' });
    await bundle.getByLabel('Nomor RM').fill('00-50-11-36');
    for (const el of [
      'Elevasi kepala 30–45°',
      'Kebersihan mulut dengan klorheksidin',
      'Evaluasi sedasi harian',
      'Profilaksis ulkus peptikum',
    ]) {
      await bundle.getByRole('checkbox', { name: el }).check();
    }
    await bundle.getByRole('button', { name: 'Simpan audit' }).click();
    await expect(bundle.getByText(/tidak patuh .* terlewat profilaksis trombosis vena dalam/)).toBeVisible();

    await page.getByRole('tab', { name: /Isolasi/ }).click();
    const room = page.getByLabel('Ruang isolasi untuk RM 00-47-90-12');
    await room.selectOption('iso-3');
    await expect(page.getByText('Kewaspadaan airborne wajib ruang bertekanan negatif.')).toBeVisible();
    await room.selectOption('iso-2');
    await page
      .getByRole('region', { name: 'Permintaan isolasi · RM 00-47-90-12' })
      .getByRole('button', { name: 'Tempatkan' })
      .click();
    await expect(page.getByText(/RM 00-47-90-12 ditempatkan di Isolasi 2/)).toBeVisible();
    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);

    // Bertahan setelah muat ulang: putusan suspek, sensus, observasi, audit bundle, penempatan isolasi.
    await page.reload();
    await expect(page.getByRole('button', { name: /^Phlebitis/ })).toContainText('Bukan HAI');
    await expect(page.getByText(/Sensus hari ini tercatat · .* oleh/)).toBeVisible();
    await page.getByRole('tab', { name: 'Kebersihan tangan' }).click();
    await expect(page.getByText(/401 peluang diamati/)).toBeVisible();
    await page.getByRole('tab', { name: /Isolasi/ }).click();
    await expect(page.getByText(/Ditempatkan di Isolasi 2 · .* oleh/)).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });
  test('B02 aset: kalibrasi laik/tidak laik, tiket perbaikan sampai ditutup, lapor kerusakan', async ({
    page,
  }) => {
    const direksi = await createAccount({ roles: ['manajemen'] });
    await loginAs(page, direksi, '/');
    await page.goto('/manajemen/aset');
    await expect(page.getByRole('heading', { name: 'Aset dan pemeliharaan', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Alat lewat jatuh tempo kalibrasi' }),
    ).toContainText('Defibrilator');

    await page.getByRole('button', { name: 'Catat kalibrasi Defibrilator' }).click();
    const save = page.getByRole('button', { name: 'Simpan hasil kalibrasi' });
    await expect(save).toBeDisabled();
    await page.getByLabel('Hasil', { exact: true }).selectOption('laik');
    await page.getByLabel('Nomor sertifikat').fill('KAL-2610-118');
    await save.click();
    await expect(page.getByText(/Defibrilator \(AST-ALK-0118\) laik pakai/)).toBeVisible();

    await page.getByRole('button', { name: 'Catat kalibrasi Timbangan bayi digital' }).click();
    await page.getByLabel('Hasil', { exact: true }).selectOption('tidak');
    await page.getByLabel('Nomor sertifikat').fill('KAL-2610-119');
    await save.click();
    await expect(
      page.getByText(/Timbangan bayi digital tidak laik .* tiket WO-2610-042 dibuat/),
    ).toBeVisible();

    await page.getByRole('tab', { name: /Perbaikan/ }).click();
    const repair = page.getByRole('tabpanel', { name: /Perbaikan/ });
    await expect(repair.getByRole('button', { name: /WO-2610-042/ })).toBeVisible();
    await repair.getByRole('button', { name: /WO-2610-041/ }).click();
    await repair.getByLabel('Teknisi', { exact: true }).selectOption({ index: 1 });
    await repair.getByRole('button', { name: 'Terima dan tetapkan teknisi' }).click();
    await repair.getByRole('button', { name: 'Mulai kerjakan' }).click();
    const done = repair.getByRole('button', { name: 'Selesai dan lulus uji' });
    await expect(done).toBeDisabled();
    await repair.getByRole('checkbox', { name: 'Uji fungsi lulus' }).check();
    await repair.getByRole('checkbox', { name: 'Uji keselamatan listrik lulus' }).check();
    await repair.getByLabel('Tindakan perbaikan').fill('Ganti kabel sensor SpO2 dan kalibrasi alarm');
    await done.click();
    // Penutupan oleh pengguna unit lain dari petugas yang menyelesaikan (pemisahan tugas memakai pengguna sesi).
    await expect(repair.getByRole('button', { name: 'Konfirmasi unit dan tutup' })).toBeDisabled();
    await expect(repair.getByText(/Anda yang menyelesaikan perbaikan/)).toBeVisible();

    await repair.getByLabel('Alat', { exact: true }).selectOption('ast-01');
    await repair.getByLabel('Keluhan').fill('Alarm tekanan jalan napas tinggi muncul tanpa sebab');
    await repair.getByLabel('Dampak ke layanan').selectOption('kritis');
    await repair.getByRole('button', { name: 'Kirim laporan' }).click();
    await expect(repair.getByText(/Tiket WO-2610-043 dibuat .* SLA respons 2 jam/)).toBeVisible();
    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);

    // Bertahan setelah muat ulang: kalibrasi, tiket otomatis, tahap tiket, dan laporan baru.
    await page.reload();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Alat lewat jatuh tempo kalibrasi' })
        .filter({ hasText: 'Defibrilator' }),
    ).toHaveCount(0);
    await page.getByRole('tab', { name: /Perbaikan/ }).click();
    await expect(repair.getByRole('button', { name: /WO-2610-042/ })).toBeVisible();
    await expect(repair.getByRole('button', { name: /WO-2610-043/ })).toBeVisible();
    await expect(repair.getByRole('button', { name: /WO-2610-041/ })).toContainText('Selesai diuji');

    await expectNoHorizontalOverflow(page);
  });
  test('B05 penggajian: impor jasa pelayanan, PPh 21 manual, hitung (penyusun = sesi), penyetuju harus pengguna lain, bertahan', async ({
    page,
  }) => {
    const akuntan = await createAccount({ roles: ['akuntan'], displayName: 'Akuntan Gaji Fiktif' });
    await loginAs(page, akuntan, '/');
    await page.goto('/manajemen/penggajian');
    await expect(page.getByRole('heading', { name: 'Penggajian · Oktober 2026', level: 1 })).toBeVisible();

    const calc = page.getByRole('button', { name: 'Hitung gaji' });
    await expect(calc).toBeDisabled();
    await page.getByRole('button', { name: 'Impor jasa pelayanan' }).click();
    await expect(page.getByText('PPh 21 belum diisi untuk 2 pegawai.')).toBeVisible();
    await page.getByLabel(`PPh 21 ${PERSONA.perawat}`).fill('95.000');
    await page.getByLabel(`PPh 21 ${PERSONA.apoteker}`).fill('118000');
    await calc.click();
    await expect(page.getByText(/PAY-2610-001: gaji 8 pegawai dihitung/)).toBeVisible();
    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);

    // Penyusun = pengguna sesi; penyetuju wajib pengguna lain (bukan nama dari dropdown).
    await expect(page.getByText(/Disusun Akuntan Gaji Fiktif/)).toBeVisible();
    const approve = page.getByRole('button', { name: 'Setujui run gaji' });
    await expect(approve).toBeDisabled();
    await expect(page.getByText(/Anda penyusun run ini: penyetuju harus pengguna lain/)).toBeVisible();

    // Bertahan setelah muat ulang: tahap, PPh 21, dan slip dari hasil hitung.
    await page.reload();
    await expect(page.getByLabel(`PPh 21 ${PERSONA.perawat}`)).toHaveValue('95000');
    await expect(page.getByLabel(`PPh 21 ${PERSONA.perawat}`)).toBeDisabled();
    await page.getByLabel('Pegawai', { exact: true }).selectOption({ label: PERSONA.perawat });
    await expect(page.getByLabel(`Slip ${PERSONA.perawat}`)).toContainText('−Rp 95.000');
    await expect(page.getByRole('region', { name: 'Jurnal gaji' })).toContainText('Debit = kredit');
    await expect(approve).toBeDisabled();
    await page.getByRole('button', { name: 'Kembali ke draf' }).click();
    await expect(calc).toBeEnabled();

    await expectNoHorizontalOverflow(page);
  });
  test('B08 PPRA: setujui/tolak beralasan, kedaluwarsa 24 jam, audit Gyssens, modul dimatikan per RS', async ({
    page,
  }) => {
    const apoteker = await createAccount({ roles: ['apoteker'], displayName: 'Apoteker PPRA Fiktif' });
    await loginAs(page, apoteker, '/');
    await page.goto('/manajemen/ppra');
    await expect(
      page.getByRole('heading', { name: 'Pengendalian resistansi antimikroba (PPRA)', level: 1 }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Setujui…' }).click();
    await expect(page.getByRole('button', { name: 'Simpan persetujuan' })).toBeDisabled();
    await page
      .getByLabel('Pertimbangan klinis tim PPRA')
      .fill('Syok septik dengan riwayat ESBL, de-eskalasi setelah kultur');
    await page.getByRole('button', { name: 'Simpan persetujuan' }).click();
    await expect(page.getByText(/AB-2610-021 Meropenem disetujui/)).toBeVisible();
    await expect(page.getByText(/tidak disimpan|\(simulasi\)/)).toHaveCount(0);

    await page.getByRole('button', { name: /AB-2610-019/ }).click();
    await page.getByRole('button', { name: 'Tolak…' }).click();
    await page
      .getByLabel('Pertimbangan klinis tim PPRA')
      .fill('Sensitif linezolid oral, bisa pulang lebih cepat');
    await expect(page.getByText('Sebutkan antibiotik alternatif yang disarankan.')).toBeVisible();
    await page.getByLabel('Antibiotik alternatif yang disarankan').fill('Linezolid oral');
    await page.getByRole('button', { name: 'Simpan penolakan' }).click();
    await expect(page.getByText(/AB-2610-019 Vankomisin ditolak .* saran Linezolid oral/)).toBeVisible();

    await page.getByRole('button', { name: /AB-2610-017/ }).click();
    await expect(page.getByText(/Tidak diputus dalam 24 jam/)).toBeVisible();

    await page.getByRole('tab', { name: 'Audit Gyssens' }).click();
    for (let i = 0; i < 6; i++)
      await page.getByRole('button', { name: 'Tidak untuk RM 00-58-02-41' }).click();
    await page.getByRole('button', { name: 'Ya untuk RM 00-58-02-41' }).click();
    await expect(page.getByText('Kategori IIIA', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Matikan modul…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Matikan modul PPRA untuk RS ini?' });
    await dialog.getByLabel(/Alasan/).fill('Uji coba konfigurasi RS tipe C tanpa tim PPRA');
    await dialog.getByRole('button', { name: 'Matikan' }).click();
    await page.getByRole('tab', { name: 'Katalog restriksi' }).click();
    const meropenem = page.getByRole('row', { name: /Meropenem/ });
    await expect(meropenem).toContainText('Langsung ke farmasi');

    // Bertahan setelah muat ulang: putusan atas nama pengguna sesi, audit, dan modul mati.
    await page.reload();
    await expect(page.getByText('Modul PPRA tidak aktif', { exact: true })).toBeVisible();
    await expect(page.getByText(/Disetujui · .* oleh Apoteker PPRA Fiktif/)).toBeVisible();
    await page.getByRole('tab', { name: 'Audit Gyssens' }).click();
    await expect(page.getByText('Kategori IIIA', { exact: true })).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });

  test('B08 PPRA: penulis resep tidak bisa memutus permintaannya sendiri', async ({ page }) => {
    const dokter = await createAccount({ roles: ['dokter'], displayName: 'dr. Kartika Sari, Sp.P' });
    await loginAs(page, dokter, '/');
    await page.goto('/manajemen/ppra');
    await page.getByRole('button', { name: 'Setujui…' }).click();
    await page.getByLabel('Pertimbangan klinis tim PPRA').fill('Pertimbangan yang cukup panjang untuk diuji');
    await expect(page.getByRole('button', { name: 'Simpan persetujuan' })).toBeDisabled();
    await expect(page.getByText(/Anda penulis resep ini/)).toBeVisible();
  });
  test('B12 dokumen: telaah → setuju (sesi ≠ penyusun) → terbit, versi baru disusun pengguna sesi, baca, bukti; bertahan', async ({
    page,
  }) => {
    const auditor = await createAccount({ roles: ['auditor_mutu'], displayName: 'Auditor Dokumen Fiktif' });
    await loginAs(page, auditor, '/');
    await page.goto('/manajemen/dokumen');
    await expect(
      page.getByRole('heading', { name: 'Dokumen regulasi dan akreditasi', level: 1 }),
    ).toBeVisible();

    // SPO-KEP-014 v3 disusun perawat (fixture): auditor sesi boleh menyetujui setelah catatan telaah.
    await page.getByRole('button', { name: 'Kirim ke telaah' }).click();
    const approve = page.getByRole('button', { name: 'Setujui dokumen' });
    await expect(approve).toBeDisabled();
    await page.getByLabel('Catatan telaah').fill('Langkah fiksasi kateter disesuaikan bundle ISK terbaru');
    await approve.click();
    await expect(page.getByText(/SPO-KEP-014 v3 disetujui Auditor Dokumen Fiktif/)).toBeVisible();
    await page.getByRole('button', { name: 'Terbitkan dan distribusikan' }).click();
    await expect(page.getByText(/SPO-KEP-014 v3 terbit .* v2 tidak berlaku/)).toBeVisible();
    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);
    await page.getByRole('button', { name: /^SPO-KEP-014 v2/ }).click();
    await expect(
      page.getByRole('img', { name: 'Pratinjau dokumen tidak berlaku bertanda air' }),
    ).toBeVisible();

    // Versi baru disusun pengguna yang memulai tinjau ulang → ia tidak bisa menyetujuinya sendiri.
    await page.getByRole('button', { name: /^SPO-FAR-022 v4/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Lewat tanggal tinjau ulang' })).toBeVisible();
    await page.getByRole('button', { name: 'Mulai tinjau ulang (versi baru)' }).click();
    await expect(
      page.getByText(/Draf SPO-FAR-022 v5 dibuat untuk tinjau ulang oleh Auditor Dokumen Fiktif/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Kirim ke telaah' }).click();
    await page.getByLabel('Catatan telaah').fill('Tinjau ulang tiga tahunan tanpa perubahan isi');
    await expect(approve).toBeDisabled();
    await expect(page.getByText(/Anda penyusun dokumen ini: penyetuju harus pengguna lain/)).toBeVisible();

    // Bertahan setelah muat ulang.
    await page.reload();
    await expect(page.getByRole('button', { name: /^SPO-KEP-014 v3/ })).toContainText('Terbit');
    await expect(page.getByRole('button', { name: /^SPO-FAR-022 v5/ })).toContainText('Telaah');

    await page.getByRole('tab', { name: 'Distribusi & baca' }).click();
    await page.getByRole('button', { name: 'Kirim pengingat ke ICU' }).click();
    await expect(page.getByText(/Pengingat baca SPO-KEP-014 dikirim ke 22 staf ICU/)).toBeVisible();
    await expect(page.getByText(/Pengingat terkirim .* oleh Auditor Dokumen Fiktif/)).toBeVisible();

    await page.getByRole('tab', { name: 'Bukti akreditasi' }).click();
    await page.getByLabel('Bab', { exact: true }).selectOption('MRMIK');
    await page.getByLabel('Dokumen terbit').selectOption('doc-kep-014-v3');
    await page.getByRole('button', { name: 'Tautkan sebagai bukti' }).click();
    await expect(page.getByRole('row', { name: /MRMIK/ })).toContainText('45/51');
    await page.reload();
    await page.getByRole('tab', { name: 'Bukti akreditasi' }).click();
    await expect(page.getByRole('row', { name: /MRMIK/ })).toContainText('45/51');

    await expectNoHorizontalOverflow(page);
  });
  test('B13 pengalaman pasien: grading → tindak lanjut → jawab → tutup; skor survei rendah jadi pengaduan', async ({
    page,
  }) => {
    const loket = await createAccount({
      roles: ['petugas_pendaftaran'],
      displayName: 'Petugas Pengaduan Fiktif',
    });
    await loginAs(page, loket, '/');
    await page.goto('/manajemen/pengaduan');
    await expect(page.getByRole('heading', { name: 'Pengalaman pasien', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ringkasan pengalaman pasien' })).toContainText('87%');
    await expect(page.getByRole('button', { name: /ADU-2610-016/ })).toContainText('Lewat SLA');

    await page.getByLabel('Grading risiko').selectOption('merah');
    await page.getByRole('button', { name: 'Simpan grading dan teruskan' }).click();
    await page
      .getByLabel('Tindak lanjut unit')
      .fill('Kepala IGD menjelaskan alur triase dan memprioritaskan pemeriksaan');
    await page.getByRole('button', { name: 'Catat tindak lanjut' }).click();
    const send = page.getByRole('button', { name: 'Kirim jawaban' });
    await page.getByLabel('Jawaban ke pelapor').fill('Mohon maaf');
    await expect(send).toBeDisabled();
    await page
      .getByLabel('Jawaban ke pelapor')
      .fill(
        'Mohon maaf atas penantian. Ayah Anda sudah diperiksa dan kami memperbaiki informasi antrean IGD.',
      );
    await send.click();
    await page.getByRole('button', { name: 'Tutup pengaduan' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Pengaduan selesai' })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Catatan tindakan (tidak bisa diubah)' }).getByRole('listitem'),
    ).toHaveCount(4);

    await page.getByRole('tab', { name: 'Survei kepuasan' }).click();
    await page.getByRole('button', { name: 'Jadikan pengaduan dari survei srv-008' }).click();
    await expect(page.getByText(/dijadikan pengaduan ADU-2610-025/).first()).toBeVisible();
    await page.getByRole('tab', { name: /Pengaduan/ }).click();
    await expect(page.getByRole('button', { name: /ADU-2610-025/ })).toBeVisible();
    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);

    // Bertahan + mengalir: jawaban dalam SLA masuk INM-12 (20/23 → 21/24), catatan atas nama pengguna sesi.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Ringkasan pengalaman pasien' })).toContainText('88%');
    await expect(page.getByRole('button', { name: /ADU-2610-024/ })).toContainText('Selesai');
    await page.getByRole('button', { name: /ADU-2610-024/ }).click();
    await expect(page.getByRole('list', { name: 'Catatan tindakan (tidak bisa diubah)' })).toContainText(
      'Petugas Pengaduan Fiktif',
    );

    await expectNoHorizontalOverflow(page);
  });
  test('B10 pendidikan klinik: verifikasi logbook membuka kenaikan tingkat supervisi; pengembalian beralasan', async ({
    page,
  }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, '/');
    await page.goto('/manajemen/pendidikan');
    await expect(page.getByRole('heading', { name: 'Pendidikan klinik', level: 1 })).toBeVisible();

    const up = page.getByRole('button', { name: 'Naikkan ke tingkat 3…' });
    await expect(up).toBeDisabled();
    await expect(page.getByText('Butuh 5 tindakan terverifikasi (baru 4).')).toBeVisible();
    await page.getByRole('button', { name: 'Verifikasi logbook Sab, 3 Okt 2026' }).click();
    await expect(up).toBeEnabled();
    await up.click();
    await page
      .getByLabel(/Pernyataan supervisor/)
      .fill('Lima pemasangan CVC mandiri dibimbing tanpa komplikasi');
    await page.getByRole('button', { name: 'Naikkan tingkat' }).click();
    await expect(page.getByText(/naik ke tingkat 3 .* co-sign retrospektif ≤ 24 jam/)).toBeVisible();

    await page.getByRole('button', { name: 'Kembalikan… logbook Min, 4 Okt 2026' }).click();
    await page
      .getByLabel('Umpan balik supervisor')
      .fill('Peran observasi tidak dihitung, lengkapi catatan tindakan');
    await page.getByRole('button', { name: 'Kembalikan', exact: true }).click();
    await expect(page.getByText(/dikembalikan dengan umpan balik/)).toBeVisible();
    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);

    // Bertahan setelah muat ulang: tingkat baru dan logbook yang diputus.
    await page.reload();
    await expect(page.getByText(/Tingkat 3 · /).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verifikasi logbook Sab, 3 Okt 2026' })).toHaveCount(0);
    await expect(page.getByText('Dikembalikan ke peserta')).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });

  test('B11 onkologi: dosis LPT, penyesuaian beralasan, gerbang neutrofil, verifikasi ganda berbeda', async ({
    page,
  }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, '/');
    await page.goto('/klinis/onkologi');
    await expect(page.getByRole('heading', { name: 'Onkologi · siklus kemoterapi', level: 1 })).toBeVisible();
    await expect(page.getByText('Ny. Maria Ulfa')).toBeVisible();
    const doses = page.getByRole('region', { name: 'Dosis per obat' });
    await expect(doses.getByRole('row', { name: /Oksaliplatin/ })).toContainText('131 mg');

    await page.getByLabel('Dosis', { exact: true }).selectOption('80');
    const lock = page.getByRole('button', { name: 'Kunci order siklus 4' });
    await expect(lock).toBeDisabled();
    await page.getByLabel('Alasan penyesuaian dosis').fill('Neuropati perifer derajat 2 sejak siklus 3');
    await expect(doses.getByRole('row', { name: /Oksaliplatin/ })).toContainText('105 mg');
    await lock.click();

    const gate = page.getByRole('alert').filter({ hasText: 'Neutrofil absolut di bawah ambang' });
    await expect(gate).toBeVisible();
    await gate.getByRole('button', { name: 'Tetap berikan dengan alasan klinis' }).click();
    await gate.getByLabel(/Alasan klinis/).fill('Tren naik dari 1.100, G-CSF diberikan, disetujui DPJP');
    await gate.getByRole('button', { name: 'Simpan alasan dan lanjut' }).click();

    await page.getByLabel('Verifikator 1').selectOption('dr. Rahmat Hidayat, Sp.PD');
    await expect(page.getByText('Verifikator harus berbeda dari penulis order.')).toBeVisible();
    await page.getByLabel('Verifikator 1').selectOption(PERSONA.apoteker);
    await page.getByRole('button', { name: 'Dosis cocok, verifikasi' }).click();
    await page.getByLabel('Verifikator 2').selectOption(PERSONA.apoteker);
    await expect(page.getByText('Verifikator kedua harus berbeda dari verifikator pertama.')).toBeVisible();
    await page.getByLabel('Verifikator 2').selectOption('Ns. Lia Kartika, S.Kep (perawat onkologi)');
    await page.getByRole('button', { name: 'Dosis cocok, verifikasi' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Verifikasi ganda selesai' })).toContainText(
      'Override gerbang lab tercatat',
    );

    await expectNoHorizontalOverflow(page);
  });
  test('I09 command center: data langsung dari IGD/bed/antrean; keputusan alert tersimpan; permintaan bed IGD mengalir', async ({
    page,
  }) => {
    const akun = await createAccount({
      roles: ['manajemen', 'dokter'],
      displayName: 'Direktur Komando Fiktif',
    });
    await loginWithPosition(page, akun, 'Manajemen');
    await page.goto('/manajemen/command-center');
    await expect(page.getByRole('heading', { name: 'Command center', level: 1 })).toBeVisible();
    const alerts = page.getByRole('region', { name: 'Alert keputusan' });
    await expect(alerts).toContainText('Kritis: 1 pasien IGD menunggu bed rawat inap');
    await expect(alerts).toContainText('ICU/ICCU 92%');
    await expect(page.getByText(/simulasi|tidak disimpan/)).toHaveCount(0);

    await alerts.getByRole('button', { name: /Putuskan tindakan.*1 pasien IGD menunggu bed/ }).click();
    const save = alerts.getByRole('button', { name: 'Simpan keputusan' });
    await expect(save).toBeDisabled();
    await alerts.getByLabel('Tindakan', { exact: true }).selectOption('Prioritaskan bed siap untuk IGD');
    await alerts
      .getByLabel('Catatan dan penanggung jawab')
      .fill('Kepala ruang Kenanga siapkan K-4xx dalam 30 menit');
    await save.click();
    await expect(alerts.getByText(/Ditindaklanjuti \d{2}\.\d{2} · Direktur Komando Fiktif/)).toBeVisible();
    await page.reload();
    await expect(alerts.getByText(/Ditindaklanjuti \d{2}\.\d{2} · Direktur Komando Fiktif/)).toBeVisible();

    // Mengalir: dokter IGD meminta bed untuk Tn. Joko → command center menghitung 2 pasien menunggu bed (alert baru).
    await switchPosition(page, 'Dokter (DPJP)');
    await page.goto('/klinis/igd');
    await page
      .getByRole('region', { name: 'Papan pasien IGD' })
      .getByRole('button', { name: /Tn\. Joko Susilo/ })
      .click();
    const disp = page.getByRole('region', { name: 'Disposisi pasien IGD' });
    await disp.getByLabel('Kelas ruang').selectOption('Kelas 2');
    await disp.getByLabel('Kebutuhan ruang').fill('Ortopedi · pantau nyeri lutut');
    await disp.getByRole('button', { name: 'Minta bed rawat inap' }).click();
    await expect(disp.getByRole('status')).toContainText('Permintaan bed Kelas 2 terkirim');

    await switchPosition(page, 'Manajemen');
    await page.goto('/manajemen/command-center');
    await expect(alerts).toContainText('2 pasien IGD menunggu bed rawat inap');
    await expect(
      alerts.getByRole('button', { name: /Putuskan tindakan.*2 pasien IGD menunggu bed/ }),
    ).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });
  test('I11 dataset riset: etik, de-identifikasi dengan k-anonimitas, penyetuju ≠ penyusun (sesi), jejak; bertahan', async ({
    page,
  }) => {
    const privasi = await createAccount({ roles: ['petugas_privasi'] });
    await loginAs(page, privasi, '/');
    await page.goto('/manajemen/dataset-riset');
    await expect(
      page.getByRole('heading', { name: 'Dataset riset ter-de-identifikasi', level: 1 }),
    ).toBeVisible();

    await page.getByLabel('Nomor persetujuan etik').fill('KEPK/031/2026');
    await page.getByLabel('Berlaku sampai').fill('2027-09-30');
    await page.getByRole('button', { name: 'Catat persetujuan etik' }).click();

    const rules: Record<string, string> = {
      'Nama pasien': 'hapus',
      'Nomor RM': 'pseudonim',
      NIK: 'hapus',
      'Nomor telepon': 'hapus',
      Umur: 'pertahankan',
      'Jenis kelamin': 'pertahankan',
      'Kecamatan domisili': 'pertahankan',
      'HbA1c terakhir': 'pertahankan',
      'Jumlah episode hipoglikemia': 'pertahankan',
      'Terapi insulin (ya/tidak)': 'pertahankan',
    };
    for (const [label, rule] of Object.entries(rules)) {
      await page.getByLabel(`Aturan ${label}`, { exact: true }).selectOption(rule);
    }
    const apply = page.getByRole('button', { name: 'Terapkan de-identifikasi' });
    await expect(apply).toBeDisabled();
    await expect(page.getByText(/k-anonimitas \d < 5/)).toBeVisible();
    await page.getByLabel('Aturan Umur', { exact: true }).selectOption('generalisasi');
    await page.getByLabel('Aturan Kecamatan domisili', { exact: true }).selectOption('hapus');
    await apply.click();

    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);

    // Penyetuju rilis = pengguna sesi (Petugas privasi) yang bukan penyusun de-identifikasi.
    const approve = page.getByRole('button', { name: 'Setujui rilis' });
    await expect(approve).toBeDisabled();
    await expect(
      page.getByText(/Anda menyusun de-identifikasi: penyetuju harus pengguna lain/),
    ).toBeVisible();

    // Bertahan setelah muat ulang: tahap, aturan kolom, dan jejak akses atas nama pengguna sesi.
    await page.reload();
    await expect(page.getByRole('list', { name: 'Tahap DSR-2610-003' })).toBeVisible();
    await expect(approve).toBeDisabled();
    const trail = page.getByRole('list', { name: 'Jejak akses dataset' });
    await expect(trail).toContainText('persetujuan etik KEPK/031/2026 dicatat');
    await expect(trail).toContainText('de-identifikasi diterapkan (k =');

    await expectNoHorizontalOverflow(page);
  });
  test('I07 aplikasi pasien: persetujuan akses keluarga dengan lingkup data dan pencabutan', async ({
    page,
  }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/');
    await page.goto('/pratinjau/aplikasi-pasien');
    const phone = page.getByRole('region', { name: 'Pratinjau aplikasi pasien' });
    await phone.getByRole('button', { name: 'Keluarga' }).click();
    const family = phone.getByRole('region', { name: 'Akses keluarga' });
    const approve = family.getByRole('button', { name: 'Setujui akses' });
    await expect(approve).toBeDisabled();
    await family.getByRole('checkbox', { name: /Hasil laboratorium/ }).check();
    await family.getByText('30 hari', { exact: true }).click();
    await expect(family.getByRole('radio', { name: '30 hari' })).toBeChecked();
    await family
      .getByRole('checkbox', { name: /Saya menyetujui Bayu Nugroho .* termasuk data kesehatan/ })
      .check();
    await approve.click();
    await expect(family.getByRole('status')).toContainText('Akses Bayu Nugroho aktif');
    await expect(family.getByRole('list', { name: 'Keluarga dengan akses' })).toContainText(
      'Hasil laboratorium',
    );
    await family.getByRole('button', { name: 'Cabut akses Ny. Ratih Nugroho' }).click();
    await expect(family.getByRole('status')).toContainText('Akses Ny. Ratih Nugroho dicabut');
    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);

    // Bertahan setelah muat ulang (toko demo `aplikasi-pasien`).
    await page.reload();
    await phone.getByRole('button', { name: 'Keluarga' }).click();
    await expect(family.getByRole('list', { name: 'Keluarga dengan akses' })).toContainText('Bayu Nugroho');
    await expect(family.getByRole('list', { name: 'Keluarga dengan akses' })).not.toContainText('Ratih');
    await expect(family.getByRole('button', { name: 'Setujui akses' })).toHaveCount(0);
  });
  test('B01 logistik: penerimaan barang menambah stok (keluar dari daftar ROP) dan utang usaha', async ({
    page,
  }) => {
    const direksi = await createAccount({ roles: ['manajemen'] });
    await loginAs(page, direksi, '/');
    await page.goto('/manajemen/logistik');
    const rop = page.getByRole('region', { name: 'Item di bawah titik pesan ulang' });
    const kasa = rop.getByRole('checkbox', { name: 'Masukkan Kasa steril 16×16 ke usulan PO' });
    await expect(kasa).toHaveCount(1);

    await page.getByRole('button', { name: 'Terima barang PO-2610-024' }).click();
    const receipt = page.getByRole('region', { name: 'Penerimaan barang PO-2610-024' });
    const record = receipt.getByRole('button', { name: 'Catat penerimaan' });
    await expect(record).toBeDisabled();
    const names = ['Kasa steril 16×16', 'Benang PGA 2-0', 'Sarung tangan steril 7,5', 'Spuit 3 mL'];
    for (const [i, name] of names.entries()) {
      await receipt.getByLabel(`Batch ${name}`).fill(`BT2610${i}`);
      await receipt.getByLabel(`Kedaluwarsa ${name}`).fill('2027-02-28');
    }
    await expect(receipt.getByText(/kurang dari 6 bulan/)).toBeVisible();
    for (const name of names) await receipt.getByLabel(`Kedaluwarsa ${name}`).fill('2028-03-31');
    await expect(receipt).toContainText('D Rp 22.700.000');
    await record.click();
    await expect(
      page.getByText(
        /GRN-2610-0145 dicatat .* utang penerimaan belum difakturkan Rp 22\.700\.000 jatuh tempo Rab, 4 Nov 2026/,
      ),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Pengadaan berjalan' })).toContainText(
      'Diterima GRN-2610-0145',
    );
    await expect(kasa).toHaveCount(0);

    await expectNoHorizontalOverflow(page);
  });

  test('B06 mutu: lima indikator dihitung dari data toko; observasi PPI mengalir ke pembilang/penyebut; hitung ulang tercatat', async ({
    page,
  }) => {
    const auditor = await createAccount({ roles: ['auditor_mutu'], displayName: 'Auditor Mutu Fiktif' });
    await loginAs(page, auditor, '/');
    await page.goto('/manajemen/mutu');
    const table = page.getByRole('region', { name: 'Indikator dari data transaksi' });
    await expect(table.getByRole('row')).toHaveCount(6);
    await expect(table.getByRole('row', { name: /kebersihan tangan/ })).toContainText('352 / 400');
    await expect(table.getByRole('row', { name: /Resume medis/ })).toContainText('44 / 50');

    // Observasi kebersihan tangan di PPI mengubah pembilang/penyebut di Mutu (bukan angka ketik).
    await page.goto('/manajemen/ppi');
    await page.getByRole('tab', { name: 'Kebersihan tangan' }).click();
    await page.getByLabel('Profesi yang diamati').selectOption('Dokter');
    await page.getByLabel('Momen').selectOption('0');
    await page.getByLabel('Tindakan').selectOption('tidak');
    await page.getByRole('button', { name: 'Catat peluang' }).click();
    await expect(page.getByText(/kepatuhan bulan ini 88% \(352\/401\)/)).toBeVisible();
    await page.goto('/manajemen/mutu');
    await expect(table.getByRole('row', { name: /kebersihan tangan/ })).toContainText('352 / 401');

    await page.getByRole('button', { name: 'Hitung ulang' }).click();
    await expect(
      page.getByText(/terakhir dihitung ulang \d{2}\.\d{2} oleh Auditor Mutu Fiktif/),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText(/terakhir dihitung ulang \d{2}\.\d{2} oleh Auditor Mutu Fiktif/),
    ).toBeVisible();
  });
});
