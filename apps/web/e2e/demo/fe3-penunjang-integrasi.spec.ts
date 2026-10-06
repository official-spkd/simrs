import { loginRole, sharedAccount, resetShared, switchRole } from './penunjang-support';
import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/**
 * Layar penunjang lanjutan (fase 4) dan integrasi (fase 7) mode presentasi (ADR-0023): alur utama dan gerbang
 * keselamatan (read-back hasil kritis, FEFO, cek ganda darah, …).
 */

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('S09 · pusat hasil kritis', () => {
  test('tidak bisa ditutup tanpa penerima dan read-back; metrik kepatuhan ikut berubah', async ({ page }) => {
    const analis = await createAccount({ roles: ['analis_lab'] });
    await loginAs(page, analis, '/penunjang/hasil-kritis');
    await expect(page.getByRole('heading', { name: 'Pusat hasil kritis', level: 1 })).toBeVisible();
    const kpi = page.getByRole('region', { name: 'Kepatuhan hasil kritis' });
    await expect(kpi).toContainText('timer berjalan');
    const list = page.getByRole('region', { name: 'Daftar hasil kritis' });
    await list.getByRole('button', { name: /Tn\. Yusuf Hidayat/ }).click();
    const detail = page.getByRole('region', { name: 'Detail hasil kritis' });
    await expect(detail.getByRole('timer')).toHaveText(/^\d{2}:\d{2}$/);
    await detail.getByRole('button', { name: 'Catat pelaporan' }).click();
    const form = detail.getByRole('form', { name: 'Catat pelaporan hasil kritis' });
    // Penerima di luar daftar tanpa nama + tanpa read-back → ditolak per isian.
    await form.getByRole('radio', { name: /Penerima lain/ }).check();
    await form.getByRole('button', { name: 'Simpan pelaporan' }).click();
    await expect(form.getByText('Nama penerima wajib diisi (minimal 5 karakter).')).toBeVisible();
    await expect(form.getByText(/Read-back wajib/)).toBeVisible();
    await form.getByRole('radio', { name: /dr\. Sinta Maharani/ }).check();
    await form.getByRole('button', { name: 'Simpan pelaporan' }).click();
    await expect(form.getByText(/Read-back wajib/)).toBeVisible();
    await form.getByRole('checkbox', { name: /Read-back terkonfirmasi/ }).check();
    await form.getByRole('button', { name: 'Simpan pelaporan' }).click();
    const saved = detail.getByRole('status').filter({ hasText: 'read-back terkonfirmasi' });
    await expect(saved).toBeVisible();
    // Tersimpan di toko demo bersama (ADR-0085), bukan simulasi.
    await expect(saved).not.toContainText('tidak disimpan');
    await expect(detail).toContainText('Dilaporkan · read-back');
    await expect(kpi).toContainText('semua sudah dilaporkan');
  });
});

test.describe('S05 · depo dan stok farmasi', () => {
  test('FEFO: batch ED terdekat keluar dulu; override wajib alasan; batch kedaluwarsa dikarantina', async ({
    page,
  }) => {
    const apoteker = await createAccount({ roles: ['apoteker'] });
    await loginAs(page, apoteker, '/penunjang/depo');
    await expect(page.getByRole('heading', { name: 'Depo & stok farmasi', level: 1 })).toBeVisible();
    await page.getByRole('tab', { name: 'Keluarkan (FEFO)' }).click();
    const form = page.getByRole('form', { name: 'Pengeluaran stok' });
    await page
      .getByRole('region', { name: 'Permintaan menunggu' })
      .getByRole('listitem')
      .filter({ hasText: 'Seftriakson' })
      .getByRole('button', { name: 'Siapkan' })
      .click();
    await expect(form).toContainText('CFX2510 · 10 vial');
    // Override FEFO tanpa alasan ditolak.
    await form.getByRole('checkbox', { name: /Pilih batch lain/ }).check();
    await form.getByLabel('Batch pilihan').selectOption('bt-cfx2511');
    await form.getByRole('button', { name: 'Keluarkan' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'wajib alasan' })).toBeVisible();
    await form.getByRole('checkbox', { name: /Pilih batch lain/ }).uncheck();
    await form.getByRole('button', { name: 'Keluarkan' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'tersimpan atas nama' })).toContainText(
      'tersimpan atas nama Pengguna E2E Fiktif',
    );

    await page.getByRole('tab', { name: 'Stok & kedaluwarsa' }).click();
    const row = page.getByRole('row', { name: /OMZ2509/ });
    await expect(row).toContainText('Kedaluwarsa');
    await row.getByRole('button', { name: 'Pindahkan ke karantina' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'tersimpan atas nama' })).toBeVisible();
    await expect(page.getByRole('row', { name: /OMZ2509/ })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Kartu stok' }).click();
    await expect(page.getByRole('row', { name: /Karantina kedaluwarsa/ })).toBeVisible();
  });
});

test.describe('S08 · bank darah', () => {
  test('crossmatch → cek ganda dua petugas → pindai gelang + kantong → reaksi menghentikan transfusi', async ({
    page,
  }) => {
    const analis = await sharedAccount('analis_lab', 'Analis Darah Fiktif');
    const second = await sharedAccount('perawat', 'Perawat Darah Fiktif');
    await resetShared(page, analis);
    await switchRole(page, 'Analis laboratorium');
    await page.goto('/penunjang/bank-darah');
    await expect(page.getByRole('heading', { name: /Bank darah/, level: 1 })).toBeVisible();
    await page
      .getByRole('region', { name: 'Permintaan darah' })
      .getByRole('button', { name: /Ny\. Anisa Rahmadani/ })
      .click();
    const detail = page.getByRole('region', { name: 'Detail permintaan darah' });
    const cross = detail.getByRole('region', { name: 'Crossmatch' });
    await expect(cross.getByRole('listitem').filter({ hasText: 'KD-260830-007' })).toContainText(
      'Kedaluwarsa',
    );
    await cross
      .getByRole('listitem')
      .filter({ hasText: 'KD-261001-044' })
      .getByRole('button', { name: 'Hasil kompatibel' })
      .click();
    await expect(cross).toContainText('2 dari 2 kantong kompatibel');

    // Dua sesi nyata wajib. Nama petugas kedua tidak lagi dapat diisi bebas.
    const issue = detail.getByRole('form', { name: 'Cek ganda pengeluaran kantong' });
    await expect(issue.getByRole('button', { name: 'Keluarkan kantong' })).toBeDisabled();
    for (const box of await issue.getByRole('checkbox').all()) await box.check();
    await issue.getByRole('button', { name: 'Catat pemeriksaan saya' }).click();
    await expect(issue).toContainText('Analis Darah Fiktif');
    await expect(issue.getByRole('button', { name: 'Keluarkan kantong' })).toBeDisabled();
    const otherContext = await page
      .context()
      .browser()!
      .newContext({ baseURL: test.info().project.use.baseURL as string });
    const other = await otherContext.newPage();
    try {
      await loginRole(other, second, 'Perawat');
      await other.goto('/penunjang/bank-darah');
      await other
        .getByRole('region', { name: 'Permintaan darah' })
        .getByRole('button', { name: /Ny\. Anisa Rahmadani/ })
        .click();
      const otherIssue = other.getByRole('form', { name: 'Cek ganda pengeluaran kantong' });
      for (const box of await otherIssue.getByRole('checkbox').all()) await box.check();
      await otherIssue.getByRole('button', { name: 'Catat pemeriksaan saya' }).click();
      await expect(otherIssue).toContainText('Analis Darah Fiktif + Perawat Darah Fiktif');
    } finally {
      await otherContext.close();
    }
    await page.reload();
    await page
      .getByRole('region', { name: 'Permintaan darah' })
      .getByRole('button', { name: /Ny\. Anisa Rahmadani/ })
      .click();
    await expect(issue).toContainText('Analis Darah Fiktif + Perawat Darah Fiktif');
    await issue.getByRole('button', { name: 'Keluarkan kantong' }).click();
    await expect(detail.getByRole('form', { name: 'Verifikasi di samping pasien' })).toBeVisible();

    // Di samping pasien: gelang salah memblokir; pindai benar → transfusi berjalan.
    const bed = detail.getByRole('form', { name: 'Verifikasi di samping pasien' });
    await bed.getByLabel('Pindai gelang pasien (No. RM)').fill('00-00-00-00');
    await bed.getByLabel('Pindai label kantong').fill('KD-261001-031');
    await bed.getByRole('button', { name: 'Cocokkan dan mulai transfusi' }).click();
    await expect(detail.getByRole('alert').filter({ hasText: 'Gelang pasien tidak cocok' })).toBeVisible();
    await bed.getByRole('button', { name: 'Pindai' }).first().click();
    await bed.getByRole('button', { name: 'Cocokkan dan mulai transfusi' }).click();
    const monitor = detail.getByRole('region', { name: 'Pemantauan transfusi' });
    await expect(monitor).toContainText('Berjalan');
    const ttv = monitor.getByRole('form', { name: 'Catat TTV transfusi' });
    await ttv.getByRole('checkbox', { name: 'Menggigil' }).check();
    await ttv.getByRole('button', { name: 'Catat TTV' }).click();
    await expect(monitor.getByRole('alert')).toContainText('Dugaan reaksi transfusi');
    await expect(monitor).toContainText('Dihentikan · reaksi');
  });
});

test.describe('S07 · gizi', () => {
  test('alergi makanan menahan baki; puasa tidak diantar; order baru wajib skrining lalu verifikasi', async ({
    page,
  }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/penunjang/gizi');
    await expect(page.getByRole('heading', { name: /Gizi/, level: 1 })).toBeVisible();
    const mawar = page.getByRole('region', { name: 'Distribusi Bangsal Mawar' });
    const wulan = mawar.getByRole('listitem').filter({ hasText: 'Ny. Wulan Sari Dewi' });
    await expect(wulan.getByRole('alert')).toContainText('mengandung alergen: udang');
    await wulan.getByRole('button', { name: /Ganti menu pengganti/ }).click();
    await expect(wulan).toContainText(/Diantar \d{2}\.\d{2}/);
    await expect(wulan).toContainText('menu pengganti');

    const vip = page.getByRole('region', { name: 'Distribusi Paviliun VIP' });
    await expect(vip.getByRole('button', { name: 'Antar ke bangsal' })).toBeDisabled();
    await expect(vip).toContainText('Pasien sedang puasa');

    const raka = mawar.getByRole('listitem').filter({ hasText: 'An. Raka Pratama' });
    await expect(raka.getByRole('button', { name: 'Antar ke bangsal' })).toBeDisabled();
    await page.getByRole('tab', { name: /Skrining gizi/ }).click();
    await page
      .getByRole('list', { name: 'Skrining gizi pasien' })
      .getByRole('listitem')
      .filter({ hasText: 'An. Raka Pratama' })
      .getByRole('button', { name: 'Simpan skrining' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'tersimpan atas nama' })).toBeVisible();
    await page.getByRole('tab', { name: /Order diet/ }).click();
    await page
      .getByRole('list', { name: 'Order diet dari DPJP' })
      .getByRole('listitem')
      .filter({ hasText: 'An. Raka Pratama' })
      .getByRole('button', { name: 'Verifikasi order' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'tersimpan atas nama' })).toBeVisible();
    await page.getByRole('tab', { name: 'Distribusi makan' }).click();
    await expect(
      page
        .getByRole('region', { name: 'Distribusi Bangsal Mawar' })
        .getByRole('listitem')
        .filter({ hasText: 'An. Raka Pratama' })
        .getByRole('button', { name: 'Antar ke bangsal' }),
    ).toBeEnabled();
  });
});

test.describe('S02 · mikrobiologi dan PA', () => {
  test('kultur bertahap sampai uji kepekaan lengkap dan TTE; laporan PA terkunci setelah TTE', async ({
    page,
  }) => {
    const analis = await createAccount({ roles: ['dokter'] });
    await loginAs(page, analis, '/penunjang/mikrobiologi');
    await expect(page.getByRole('heading', { name: /Mikrobiologi/, level: 1 })).toBeVisible();
    const detail = page.getByRole('region', { name: 'Detail kultur' });
    await expect(detail).toContainText('L2610040398');
    await detail.getByLabel(/Organisme \(daftar lokal/).selectOption('Escherichia coli');
    await detail.getByRole('button', { name: 'Simpan identifikasi' }).click();
    const ast = detail.getByRole('form', { name: 'Uji kepekaan antibiotik' });
    await expect(ast.getByRole('row', { name: /Kotrimoksazol/ })).toContainText('alergi pasien');
    await ast.getByRole('button', { name: 'Simpan uji kepekaan' }).click();
    await expect(detail.getByRole('alert')).toContainText('Semua antibiotik di panel wajib diisi');
    for (const select of await ast.getByRole('combobox').all()) await select.selectOption('S');
    await ast.getByRole('button', { name: 'Simpan uji kepekaan' }).click();
    await detail.getByRole('button', { name: /Validasi & TTE/ }).click();
    await expect(detail.getByText(/Laporan akhir ditandatangani/)).toBeVisible();

    await page.getByRole('tab', { name: 'Patologi anatomi' }).click();
    await page
      .getByRole('region', { name: 'Daftar patologi anatomi' })
      .getByRole('button', { name: /Ny\. Maria Ulfa/ })
      .click();
    const pa = page.getByRole('region', { name: 'Detail patologi anatomi' });
    await pa.getByRole('button', { name: /Tandatangani/ }).click();
    await expect(pa.getByRole('alert')).toContainText('minimal 10 karakter');
    await pa.getByLabel('Diagnosis (kesimpulan)').fill('Adenokarsinoma kolon berdiferensiasi sedang');
    await pa.getByRole('button', { name: /Tandatangani/ }).click();
    await expect(pa.getByText(/terkunci$/)).toBeVisible();
    await expect(pa.getByLabel('Diagnosis (kesimpulan)')).toHaveAttribute('readonly', '');
    await pa
      .getByLabel('Addendum (laporan asli tidak diubah)')
      .fill('Imunohistokimia MMR menyusul 7 hari kerja');
    await pa.getByRole('button', { name: 'Tambah addendum' }).click();
    await expect(pa).toContainText('Imunohistokimia MMR menyusul');
  });
});

test.describe('S10 · diagnostik lain', () => {
  test('EKG cito: jadwal → identitas wajib → ekspertise lengkap ber-TTE', async ({ page }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, '/penunjang/diagnostik');
    await page
      .getByRole('region', { name: 'Worklist diagnostik' })
      .getByRole('button', { name: /Tn\. Ahmad Fauzi/ })
      .click();
    const detail = page.getByRole('region', { name: 'Detail pemeriksaan' });
    await expect(detail).toContainText('ICD-9-CM 89.52');
    await detail.getByRole('button', { name: 'Jadwalkan' }).click();
    await detail.getByRole('button', { name: 'Mulai dan catat pelaksanaan' }).click();
    await expect(detail.getByRole('alert')).toContainText('Konfirmasi identitas pasien');
    await detail.getByRole('checkbox', { name: /Identitas pasien dicocokkan/ }).check();
    await detail.getByRole('button', { name: 'Mulai dan catat pelaksanaan' }).click();
    const form = detail.getByRole('form', { name: 'Ekspertise EKG 12 sadapan' });
    await form.getByRole('button', { name: /Simpan dan tandatangani/ }).click();
    await expect(detail.getByRole('alert')).toContainText('Semua isian ekspertise wajib diisi');
    for (const box of await form.getByRole('textbox').all()) await box.fill('Dalam batas normal');
    await form.getByRole('button', { name: /Simpan dan tandatangani/ }).click();
    await expect(detail.getByText(/Ekspertise ditandatangani Pengguna E2E Fiktif/)).toBeVisible();
  });
});

test.describe('S06 · anestesi di layar Kamar operasi', () => {
  test('induksi terkunci sampai asesmen pra-anestesi ber-TTE lalu sign in WHO', async ({ page }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, '/penunjang/kamar-operasi?pilih=ok3-1');
    const anestesi = page.getByRole('region', { name: 'Anestesi' });
    await expect(anestesi.getByRole('button', { name: 'Catat induksi' })).toBeDisabled();
    await expect(anestesi).toContainText('asesmen pra-anestesi belum ditandatangani');
    const form = anestesi.getByRole('form', { name: 'Asesmen pra-anestesi' });
    await expect(form.getByRole('button', { name: /Tandatangani asesmen/ })).toBeDisabled();
    await form.getByLabel('Kelas ASA').selectOption('II');
    await form.getByLabel('Jalan napas').selectOption('Mallampati II');
    await form.getByLabel('Rencana anestesi').fill('Anestesi spinal');
    await form.getByRole('checkbox', { name: /Persetujuan tindakan anestesi/ }).check();
    await form.getByRole('button', { name: /Tandatangani asesmen/ }).click();
    await expect(anestesi).toContainText('ASA IIE');
    await expect(anestesi).toContainText('konfirmasi sign in daftar tilik WHO lebih dulu');
    await expect(anestesi.getByRole('button', { name: 'Catat induksi' })).toBeDisabled();
  });
});

test.describe('I02 · SATUSEHAT', () => {
  test('galat 422 tanpa IHS: anak ditahan; lookup IHS → kirim ulang berkonfirmasi → dilepas berurutan dan diaudit', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/integrasi/satusehat');
    await expect(page.getByRole('heading', { name: /SATUSEHAT/, level: 1 })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Sub-menu integrasi' }).getByRole('link', { name: 'SATUSEHAT' }),
    ).toHaveAttribute('aria-current', 'page');
    await page
      .getByRole('region', { name: 'Kunjungan' })
      .getByRole('button', { name: /Ny\. Fransiska/ })
      .click();
    const detail = page.getByRole('region', { name: 'Detail kunjungan SATUSEHAT' });
    await expect(detail.getByRole('row', { name: /Condition/ })).toContainText('menunggu Encounter terkirim');
    const payload = detail.getByRole('region', { name: 'Payload Encounter' });
    await expect(payload).toContainText('"nik": "•••"');
    await expect(payload.getByRole('button', { name: 'Kirim ulang' })).toBeDisabled();
    await payload.getByRole('button', { name: 'Cari IHS lewat NIK' }).click();
    await expect(detail).toContainText('terverifikasi');
    await payload.getByRole('button', { name: 'Kirim ulang' }).click();
    await payload
      .getByRole('group', { name: 'Konfirmasi kirim ulang' })
      .getByRole('button', { name: 'Ya, kirim ulang' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Perubahan demo tersimpan' })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Kunjungan' }).getByRole('button', { name: /Ny\. Fransiska/ }),
    ).toContainText('4/4 terkirim');
    await expect(page.getByRole('region', { name: 'Jejak audit integrasi' })).toContainText(
      'Kirim ulang Encounter',
    );
  });
});

test.describe('I03 · konektor BPJS', () => {
  test('task ID dikirim ulang berurutan; mode downtime wajib alasan lalu backlog disinkronkan', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/integrasi/bpjs');
    const detail = page.getByRole('region', { name: 'Detail BPJS Antrean' });
    const booking = detail.getByRole('listitem').filter({ hasText: '2610050093' }).first();
    await expect(booking).toContainText('task 4 harus terkirim lebih dulu');
    await booking.getByRole('button', { name: 'Kirim ulang berurutan' }).click();
    await booking.getByRole('button', { name: 'Ya, kirim berurutan' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Perubahan demo tersimpan' })).toBeVisible();
    await expect(booking.getByRole('button', { name: 'Kirim ulang berurutan' })).toHaveCount(0);

    const downtime = page.getByRole('region', { name: 'Mode downtime BPJS' });
    await downtime.getByRole('button', { name: 'Mode downtime BPJS' }).click();
    await downtime.getByRole('button', { name: 'Aktifkan mode downtime' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Alasan mode downtime wajib' })).toBeVisible();
    await downtime.getByLabel(/Alasan mode downtime/).fill('Gangguan VClaim nasional sejak 10.50');
    await downtime.getByRole('button', { name: 'Aktifkan mode downtime' }).click();
    await expect(downtime).toContainText('Mode downtime BPJS aktif');
    await downtime.getByRole('button', { name: /Catat pendaftaran BPJS/ }).click();
    await downtime.getByRole('button', { name: 'Pulihkan & sinkronkan' }).click();
    await expect(downtime.getByText('1 transaksi tertunda disinkronkan', { exact: true })).toBeVisible();
  });
});

test.describe('I04, I06, I12 · Kemenkes, perangkat, API publik', () => {
  test('SIRS rawat inap tertahan validasi; setelah dilengkapi dikirim berkonfirmasi', async ({ page }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/integrasi/kemenkes');
    await page
      .getByRole('region', { name: 'Daftar laporan' })
      .getByRole('button', { name: /kegiatan rawat inap/ })
      .click();
    const detail = page.getByRole('region', { name: 'Detail laporan' });
    await expect(detail.getByRole('button', { name: 'Kirim ke Kemenkes' })).toBeDisabled();
    await detail.getByRole('button', { name: 'Lengkapi dari rekam medis' }).click();
    await detail.getByRole('button', { name: 'Kirim ke Kemenkes' }).click();
    await detail.getByRole('button', { name: 'Ya, kirim' }).click();
    await expect(detail.getByText(/tanda terima SIRS-2610-/)).toBeVisible();
  });

  test('gateway HL7: pesan cocok → ACK AA draf; nomor lab asing → AE; PID tersamar', async ({ page }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/integrasi/perangkat');
    const form = page.getByRole('form', { name: 'Simulasi pesan masuk' });
    await form.getByRole('button', { name: 'Kirim ke gateway' }).click();
    const log = page.getByRole('region', { name: 'Log pesan gateway' });
    await expect(log.getByRole('listitem').first()).toContainText('ACK AA');
    await expect(log).toContainText('sebagai draf');
    await expect(log).toContainText('PID|||•••');
    await form
      .getByLabel('Pesan contoh')
      .selectOption({ label: 'Hematologi · L2610059999 (nomor lab tidak dikenal)' });
    await form.getByRole('button', { name: 'Kirim ke gateway' }).click();
    await expect(log.getByRole('listitem').first()).toContainText('ACK AE');
  });

  test('API publik: cakupan klinis wajib dasar persetujuan; rotasi kunci berkonfirmasi', async ({ page }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/integrasi/api-publik');
    const form = page.getByRole('form', { name: 'Daftarkan klien baru' });
    await form.getByLabel('Nama klien').fill('Mitra D');
    await form.getByLabel('Tujuan pemakaian').fill('Integrasi hasil lab untuk klinik rujukan');
    await form.getByRole('checkbox', { name: 'Observation.read' }).check();
    await form.getByRole('button', { name: 'Daftarkan klien' }).click();
    await expect(form.getByRole('alert')).toContainText('wajib dasar persetujuan');
    await form.getByLabel(/Dasar persetujuan/).fill('PKS No. 22/2026 dengan klinik rujukan');
    await form.getByRole('button', { name: 'Daftarkan klien' }).click();
    await expect(page.getByRole('article', { name: 'Klien Mitra D' })).toBeVisible();
    const asuransi = page.getByRole('article', { name: 'Klien Asuransi mitra A' });
    await expect(asuransi).toContainText('Rotasi dalam');
    await asuransi.getByRole('button', { name: 'Rotasi kunci' }).click();
    await asuransi.getByRole('button', { name: 'Ya, rotasi kunci' }).click();
    await expect(asuransi).toContainText('Kunci berlaku 365 hari');
  });
});

test.describe('tablet 768 px', () => {
  test('layar penunjang lanjutan tanpa scroll horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    const apoteker = await createAccount({ roles: ['apoteker'] });
    await loginAs(page, apoteker, '/penunjang/depo');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
