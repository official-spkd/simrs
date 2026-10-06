import { expect, type Page, test } from '@playwright/test';
import { type Account, createAccount, loginAs, submitPassword, totpFor, typeCode } from '../support/accounts';

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

/**
 * Integrasi, logistik, mutu, dan pratinjau aplikasi pasien/dokter (mode presentasi, ADR-0023). Aksi logistik dan
 * aplikasi tersimpan di toko demo bersama (ADR-0085): tiap alur memeriksa bertahan (muat ulang) dan mengalir.
 */

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('domain manajemen', () => {
  test('integration hub: kartu antarmuka, saring DLQ, kirim ulang terkonfirmasi, uji downtime', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/');
    await page.goto('/sistem/integrasi');
    await expect(
      page.getByRole('heading', { name: 'Integrasi · pemantauan antarmuka', level: 1 }),
    ).toBeVisible();

    const cards = page.getByRole('region', { name: 'Status antarmuka' });
    await expect(cards.getByRole('button')).toHaveCount(9);
    const pacs = cards.getByRole('button', { name: /PACS radiologi/ });
    await expect(pacs).toContainText('Gangguan');
    await pacs.click();
    await expect(pacs).toHaveAttribute('aria-pressed', 'true');

    const dlq = page.getByRole('region', { name: 'Dead-letter queue' });
    await expect(dlq.getByText('Tujuan: PACS radiologi · 2 pesan')).toBeVisible();
    const resend = dlq.getByRole('button', { name: /^Kirim ulang terpilih/ });
    await expect(resend).toBeDisabled();
    await expect(dlq.getByText('Centang minimal satu pesan untuk dikirim ulang.')).toBeVisible();

    await dlq.getByRole('checkbox', { name: /RAD-2610-118/ }).check();
    await expect(resend).toBeEnabled();
    await resend.click();
    const confirm = page.getByRole('alertdialog', { name: /Kirim ulang 1 pesan ke PACS radiologi/ });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Ya, kirim ulang' }).click();
    await expect(dlq.getByRole('status')).toContainText('(simulasi, tidak disimpan)');
    // Fokus kembali ke tombol pemicu setelah konfirmasi tertutup.
    await expect(resend).toBeFocused();
    await expect(dlq.getByText('Tujuan: PACS radiologi · 1 pesan')).toBeVisible();
    await expect(dlq.getByLabel('Payload galat')).toContainText('RAD-2610-117');

    // Galat permanen (4xx / penolakan bisnis) tidak bisa dikirim ulang tanpa perbaikan data; ada tautan perbaikan.
    await cards.getByRole('button', { name: /SATUSEHAT/ }).click();
    await expect(dlq.getByText(/Tujuan: SATUSEHAT/)).toBeVisible();
    await expect(dlq.getByRole('checkbox', { name: /Encounter/ })).toBeDisabled();
    await expect(dlq.getByText(/Galat permanen: perbaiki datanya dulu/).first()).toBeVisible();
    await expect(dlq.getByRole('link', { name: /Perbaiki di SATUSEHAT/ }).first()).toHaveAttribute(
      'href',
      '/sistem/integrasi/satusehat',
    );
    await expect(page.getByRole('link', { name: 'Log audit' })).toHaveAttribute('href', '/sistem/audit');

    await page.getByRole('button', { name: 'Uji mode downtime' }).click();
    await expect(page.getByText(/Mode downtime aktif sejak/)).toBeVisible();
    await expect(cards.getByRole('button', { name: /SATUSEHAT/ })).toContainText('Antre lokal');
    await expect(dlq.getByText(/Ditahan selama uji downtime/)).toBeVisible();
    await page.getByRole('button', { name: 'Pulihkan' }).click();
    await expect(page.getByText(/Koneksi pulih pukul/)).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });

  test('logistik: usulan PO tersimpan, penyetuju ≠ pengusul, PO → kirim → terima menambah stok, bertahan', async ({
    page,
  }) => {
    const direksi = await createAccount({ roles: ['manajemen'] });
    await loginAs(page, direksi, '/');
    await page.goto('/manajemen/logistik');
    await expect(
      page.getByRole('heading', { name: 'Rantai pasok · stok dan pengadaan', level: 1 }),
    ).toBeVisible();
    const kpi = page.getByRole('region', { name: 'Indikator logistik' });
    await expect(kpi.getByText('Rp 4,82 M')).toBeVisible();

    // Mockup: semua item yang bisa diusulkan sudah tercentang; item di PO terbuka terkunci (tidak dipesan ganda).
    const make = page.getByRole('button', { name: /^Buat usulan PO/ });
    const table = page.getByRole('region', { name: 'Item di bawah titik pesan ulang' });
    await expect(table.getByText('Kritis · 4 hari').filter({ visible: true }).first()).toBeVisible();
    await expect(table.getByText('Masuk PO-2610-031').filter({ visible: true }).first()).toBeVisible();
    await expect(
      table.getByRole('checkbox', { name: 'Masukkan Enoksaparin 60 mg/0,6 mL ke usulan PO' }),
    ).toBeDisabled();
    await expect(table.getByText('Masuk PO-2610-024').filter({ visible: true }).first()).toBeVisible();
    await expect(make).toHaveText('Buat usulan PO (7)');
    await expect(make).toBeEnabled();

    const all = table.getByRole('checkbox', { name: 'Pilih semua item yang tampil untuk usulan PO' });
    await all.uncheck();
    await expect(make).toBeDisabled();
    await expect(page.getByText('Centang item dulu untuk membuat usulan.')).toBeVisible();
    await table.getByRole('checkbox', { name: 'Masukkan Seftriakson 1 g inj ke usulan PO' }).check();
    await expect(make).toBeEnabled();
    await make.click();

    const draft = page.getByRole('region', { name: 'Draf usulan PO-2610-032' });
    await expect(draft).toContainText('Rp 14.700.000');
    await draft.getByRole('button', { name: 'Ajukan ke direktur' }).click();
    await expect(page.getByText(/Usulan PO-2610-032 diajukan ke direktur pukul/)).toBeVisible();
    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);
    await expect(table.getByText('Masuk PO-2610-032').filter({ visible: true }).first()).toBeVisible();
    const orders = page.getByRole('region', { name: 'Pengadaan berjalan' });
    // Pengusul (pengguna sesi yang sama, walau posisinya Manajemen) tidak bisa menyetujui usulannya sendiri.
    const own = orders.getByRole('listitem', { name: /PO-2610-032/ });
    await expect(own).toContainText('penyetuju harus pengguna lain');
    await expect(own.getByRole('button', { name: /Setujui/ })).toHaveCount(0);

    // Bertahan setelah muat ulang.
    await page.reload();
    await expect(own).toContainText('Diajukan');
    await expect(table.getByText('Masuk PO-2610-032').filter({ visible: true }).first()).toBeVisible();

    // PO darurat enoksaparin: setujui → terbit → dikirim → terima barang (stok +300, keluar dari daftar ROP).
    const enox = orders.getByRole('listitem', { name: /PO-2610-031/ });
    await enox.getByRole('button', { name: 'Setujui PO-2610-031' }).click();
    await expect(enox).toContainText(/Disetujui direktur .* oleh/);
    await enox.getByRole('button', { name: 'Terbitkan PO PO-2610-031' }).click();
    await expect(enox).toContainText('PO terbit ke Distributor farmasi A');
    await enox.getByRole('button', { name: 'Konfirmasi dikirim pemasok PO-2610-031' }).click();
    await enox.getByRole('button', { name: 'Terima barang PO-2610-031' }).click();
    const gr = page.getByRole('region', { name: 'Penerimaan barang PO-2610-031' });
    await gr.getByLabel('Batch Enoksaparin 60 mg/0,6 mL').fill('ENX2610B');
    await gr.getByLabel('Kedaluwarsa Enoksaparin 60 mg/0,6 mL').fill('2028-06-30');
    await gr.getByRole('button', { name: 'Catat penerimaan' }).click();
    await expect(page.getByText(/GRN-2610-0145 dicatat .*diteruskan ke Hutang usaha/)).toBeVisible();
    await expect(enox).toContainText('Diterima GRN-2610-0145');
    await expect(table.getByRole('checkbox', { name: /Enoksaparin/ })).toHaveCount(0);
    await expect(kpi.getByText('Rp 4,86 M')).toBeVisible();

    await page.reload();
    await expect(enox).toContainText('Diterima GRN-2610-0145');
    await expect(kpi.getByText('Rp 4,86 M')).toBeVisible();

    // Kedaluwarsa FEFO: tindakan tersimpan atas nama pengguna sesi.
    const ed = page.getByRole('region', { name: 'Kedaluwarsa ≤ 90 hari' });
    await ed.getByRole('button', { name: 'Pindahkan ke depo ICU' }).first().click();
    await expect(ed).toContainText(/Dipindahkan ke depo ICU .* oleh/);
    await page.reload();
    await expect(ed).toContainText(/Dipindahkan ke depo ICU .* oleh/);

    await expectNoHorizontalOverflow(page);
  });

  test('mutu: indikator seperti dasbor, IKP hanya nomor RM, matriks risiko', async ({ page }) => {
    const auditor = await createAccount({ roles: ['auditor_mutu'] });
    await loginAs(page, auditor, '/');
    await page.goto('/manajemen/mutu');
    await expect(
      page.getByRole('heading', { name: 'Mutu dan keselamatan pasien · Oktober 2026', level: 1 }),
    ).toBeVisible();

    const indicators = page.getByRole('region', { name: /Indikator mutu/ });
    const identification = indicators
      .getByRole('listitem')
      .filter({ hasText: 'Kepatuhan identifikasi pasien' });
    await expect(identification).toContainText('97%');
    await expect(identification).toContainText('Di bawah sasaran');
    await expect(indicators.getByText('Kepatuhan kebersihan tangan')).toBeVisible();
    await indicators.getByRole('button', { name: 'Di bawah sasaran' }).click();
    await expect(indicators.getByText('Kepatuhan kebersihan tangan')).toHaveCount(0);
    await expect(identification).toBeVisible();

    const incidents = page.getByRole('region', { name: 'Laporan insiden keselamatan pasien' });
    await expect(incidents.getByText('IKP-2610-014')).toBeVisible();
    await expect(incidents).toContainText('RM 00-07-61-33');
    await expect(incidents).not.toContainText('Endang');
    await expect(page.getByRole('table', { name: /Matriks risiko/ })).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });

  test('pratinjau aplikasi pasien: gula darah, booking jadwal, akses keluarga tersimpan; aplikasi dokter: Hartono lewat Simulasi', async ({
    page,
  }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/');
    await page.goto('/sistem/integrasi');
    await expect(page.getByText('Layar ini untuk posisi lain')).toBeVisible();

    await page.goto('/pratinjau/aplikasi-pasien');
    const phone = page.getByRole('region', { name: 'Pratinjau aplikasi pasien' });
    await expect(phone).toBeVisible();
    await expect(phone).toHaveAttribute('data-scale', /\d/);
    await expect(phone.getByRole('region', { name: 'Antrean aktif' })).toContainText('2610050117');
    await expect(phone.getByText('Pak Suryo')).toBeVisible();
    const glucose = phone.getByRole('region', { name: 'Gula darah' });
    await glucose.getByRole('button', { name: 'Catat hasil hari ini' }).click();
    await glucose.getByLabel('Hasil gula darah (mg/dL)').fill('65');
    await glucose.getByRole('button', { name: 'Simpan' }).click();
    await expect(glucose).toContainText('di bawah sasaran');
    await expect(glucose.getByRole('alert')).toContainText('Gula darah rendah');
    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);

    // Booking jadwal dari Jadwal dokter (kuota JKN tersisa) → kode BK, tampil di Jadwal + Notifikasi.
    await phone.getByRole('button', { name: /Daftar berobat/ }).click();
    const booking = phone.getByRole('region', { name: 'Booking jadwal' });
    await booking
      .getByRole('button', { name: /^Pesan/ })
      .first()
      .click();
    await expect(booking.getByRole('status')).toContainText('Booking BK-2610-041 terdaftar');
    await expect(booking.getByRole('list', { name: 'Booking saya' })).toContainText('BK-2610-041');

    // Bertahan setelah muat ulang: gula darah, booking, notifikasi.
    await page.reload();
    await expect(glucose).toContainText('65 mg/dL');
    await expect(glucose.getByRole('alert')).toContainText('Gula darah rendah');
    await phone.getByRole('button', { name: /Daftar berobat/ }).click();
    await expect(booking.getByRole('list', { name: 'Booking saya' })).toContainText('BK-2610-041');
    await phone.getByRole('button', { name: 'Notifikasi' }).click();
    await expect(phone.getByText('Booking BK-2610-041 terdaftar')).toBeVisible();

    // Akses keluarga: setujui permintaan dengan lingkup + masa berlaku; bertahan.
    await page.reload();
    await phone.getByRole('button', { name: /^Keluarga/ }).click();
    const family = phone.getByRole('region', { name: 'Akses keluarga' });
    await family.getByText('Sampai saya cabut').click();
    await family.getByRole('checkbox', { name: /Saya menyetujui/ }).check();
    await family.getByRole('button', { name: 'Setujui akses' }).click();
    await expect(family.getByRole('list', { name: 'Keluarga dengan akses' })).toContainText('Bayu Nugroho');
    await page.reload();
    await phone.getByRole('button', { name: /^Keluarga/ }).click();
    await expect(family.getByRole('list', { name: 'Keluarga dengan akses' })).toContainText('Bayu Nugroho');

    await page.goto('/pratinjau/aplikasi-dokter');
    const doctor = page.getByRole('region', { name: 'Pratinjau aplikasi dokter' });
    await expect(doctor).toHaveAttribute('data-scale', /\d/);
    const critical = doctor.getByRole('alert', { name: 'Nilai kritis' });
    await expect(critical).toContainText('Kalium 6,8 mmol/L');
    // Pasien skenario: read-back tersimpan hanya lewat Simulasi (tidak ada lagi read-back lokal "tidak disimpan").
    await critical.getByLabel(/dibacakan ulang/).fill('6,8');
    await expect(critical.getByRole('button', { name: 'Read-back benar' })).toBeDisabled();
    await expect(critical).toContainText('pasien skenario Simulasi IGD');

    // Mockup AppDokter: Profil → Keluar (hanya pratinjau ponsel) → Masuk lagi.
    await doctor.getByRole('button', { name: 'Profil' }).click();
    await doctor.getByRole('button', { name: 'Keluar' }).click();
    await expect(doctor.getByRole('status')).toHaveText('Anda sudah keluar dari aplikasi dokter');
    await doctor.getByRole('button', { name: 'Masuk lagi' }).click();
    await expect(doctor.getByRole('region', { name: 'Daftar pasien' })).toBeVisible();
  });

  test('aplikasi dokter: read-back nilai kritis tersimpan ke Pusat hasil kritis (tampil di Lab); co-sign CPPT residen', async ({
    page,
  }) => {
    const akun = await createAccount({
      roles: ['dokter', 'analis_lab'],
      displayName: 'dr. Penerima Aplikasi Fiktif',
    });
    await loginWithPosition(page, akun, 'Dokter (DPJP)');
    await page.goto('/pratinjau/aplikasi-dokter');
    const doctor = page.getByRole('region', { name: 'Pratinjau aplikasi dokter' });
    const yusuf = doctor.getByRole('group', { name: 'Nilai kritis Tn. Yusuf Hidayat' });
    const head = (await yusuf.locator('span').first().textContent()) ?? '';
    const value = /· ([\d,.]+)/.exec(head)?.[1] ?? '';
    expect(value).not.toBe('');
    const ok = yusuf.getByRole('button', { name: /Read-back benar/ });
    await yusuf.getByRole('textbox').fill('1,0');
    await expect(ok).toBeDisabled();
    await yusuf.getByRole('textbox').fill(value);
    await ok.click();
    await expect(yusuf.getByRole('status')).toContainText(
      /Read-back tercatat \d{2}\.\d{2} oleh dr\. Penerima Aplikasi Fiktif/,
    );

    // Co-sign CPPT residen atas nama pengguna sesi; bertahan setelah muat ulang.
    const cosign = doctor.getByRole('region', { name: 'Co-sign CPPT residen' });
    await expect(cosign).toContainText('3 menunggu');
    await cosign.getByRole('button', { name: 'Setujui (TTE)' }).click();
    await expect(cosign).toContainText(/Ditandatangani \(TTE\) .* oleh dr\. Penerima Aplikasi Fiktif/);
    await expect(cosign).toContainText('2 menunggu');
    await page.reload();
    await expect(cosign).toContainText('2 menunggu');
    await expect(yusuf.getByRole('status')).toContainText('Read-back tercatat');

    // Mengalir: Laboratorium melihat nilai kritis sudah dilaporkan ke dokter itu.
    await page.goto('/');
    await switchPosition(page, 'Analis laboratorium');
    await page.goto('/penunjang/lab');
    await expect(
      page.getByRole('region', { name: /Nilai kritis dilaporkan · Tn\. Yusuf Hidayat/ }),
    ).toContainText('dr. Penerima Aplikasi Fiktif');
  });

  test('pratinjau aplikasi pasien: posisi antrean hidup dari papan antrean (mockup AppPasien)', async ({
    page,
  }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/simulasi');
    await page.getByText('Lompat ke tahap', { exact: true }).click();
    await page.getByRole('button', { name: /^\d+\. Asesmen perawat$/ }).click();
    await expect(page.getByText(/Langkah \d+ dari \d+ · Asesmen perawat/)).toBeVisible();

    await page.goto('/pratinjau/aplikasi-pasien');
    const phone = page.getByRole('region', { name: 'Pratinjau aplikasi pasien' });
    const queue = phone.getByRole('region', { name: 'Antrean aktif' });
    await expect(queue).toContainText('PD-027');
    await expect(queue).toContainText(/Sedang dilayani/);
    await expect(queue.getByRole('button', { name: /Simulasi antrean maju/ })).toHaveCount(0);
    await expect(queue).toContainText(/\d+ pasien lagi|Giliran Anda/);

    await phone.getByRole('button', { name: 'Notifikasi' }).click();
    const notif = phone.getByRole('region', { name: 'Notifikasi' });
    await expect(notif.getByText(/Antrean tersisa \d pasien|Giliran Anda dipanggil/)).toBeVisible();
    await expect(notif.getByText('SEP terbit, antrean poli aktif')).toBeVisible();
  });
});
