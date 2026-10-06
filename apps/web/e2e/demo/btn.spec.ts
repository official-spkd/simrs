import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/**
 * Pembayaran digital TPDI × BTN, pembiayaan BTN, dan kamar operasi (mode presentasi, ADR-0023; mockup
 * PembayaranBTN, PembiayaanBTN, OK). Akun baru = skenario Simulasi belum berjalan, jadi yang diuji data dummy dasar.
 */

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('kamar operasi', () => {
  test('Mulai insisi terkunci sampai time out lengkap; override wajib beralasan', async ({ page }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, '/penunjang/kamar-operasi');
    await expect(
      page.getByRole('heading', { name: 'Kamar operasi · jadwal dan keselamatan', level: 1 }),
    ).toBeVisible();
    const jadwal = page.getByRole('region', { name: 'Jadwal kamar' });
    await expect(jadwal.getByRole('button', { name: /Ny\. Ratna Sari/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      page.getByRole('heading', { name: 'OK 2 · Kolesistektomi laparoskopik', level: 2 }),
    ).toBeVisible();
    await expect(page.getByText('ICD-9-CM 51.23 · Kolesistektomi laparoskopik')).toBeVisible();

    // Akun baru: skenario belum sampai langkah operasi, jadi kasus Ny. Ratna masih terjadwal tanpa fase terkonfirmasi.
    const tilik = page.getByRole('region', { name: 'Daftar tilik keselamatan' });
    await expect(tilik.getByText('Pasien skenario Simulasi · menunggu langkah operasi')).toBeVisible();
    const insisi = page.getByRole('button', { name: 'Mulai insisi', exact: true });
    await expect(insisi).toBeDisabled();
    await expect(page.getByText('Sign in belum dikonfirmasi; induksi dan insisi terkunci.')).toBeVisible();

    // Sign in dulu (lima butir + konfirmasi); baru setelah itu gerbang time out berlaku.
    const signIn = tilik.getByRole('group', { name: 'Sign in', exact: true });
    for (const box of await signIn.getByRole('checkbox').all()) await box.check();
    await tilik.getByRole('button', { name: 'Konfirmasi sign in' }).click();
    await expect(tilik.getByText(/Sign in dikonfirmasi oleh .* \(simulasi, tidak disimpan\)/)).toBeVisible();
    await expect(page.getByText('Insisi terkunci: time out belum lengkap')).toBeVisible();

    // Override darurat menuntut alasan klinis minimal 15 karakter.
    await page.getByRole('button', { name: 'Mulai insisi tanpa time out lengkap (darurat)' }).click();
    await page.getByLabel(/Alasan klinis/).fill('darurat');
    await expect(page.getByRole('button', { name: 'Simpan alasan dan lanjut' })).toBeDisabled();
    await page.getByRole('button', { name: 'Batal' }).click();

    const timeOut = tilik.getByRole('group', { name: 'Time out', exact: true });
    for (const box of await timeOut.getByRole('checkbox').all()) await box.check();
    await expect(insisi).toBeDisabled();
    await tilik.getByRole('button', { name: 'Konfirmasi time out' }).click();
    await expect(tilik.getByText(/Time out dikonfirmasi oleh .* \(simulasi, tidak disimpan\)/)).toBeVisible();
    await expect(insisi).toBeEnabled();
    await insisi.click();
    await expect(page.getByText(/✓ Insisi dicatat \d{2}\.\d{2}/)).toBeVisible();

    // Kasus lain lewat Gantt: blok terjadwal belum punya daftar tilik yang terisi.
    await jadwal.getByRole('button', { name: /Ny\. Anisa Rahmadani/ }).click();
    await expect(page).toHaveURL(/pilih=ok3-1/);
    await expect(page.getByRole('heading', { name: 'OK 3 · Seksio sesarea cito', level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mulai insisi', exact: true })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('pembayaran digital TPDI × BTN', () => {
  test('transaksi, pelunasan simulasi, dan pengecualian rekonsiliasi wajib bercatatan', async ({ page }) => {
    const kasir = await createAccount({ roles: ['kasir'] });
    await loginAs(page, kasir, '/keuangan/pembayaran');
    await expect(
      page.getByRole('heading', { name: 'Pembayaran digital · TPDI × BTN', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Alur dana' }).getByText('tidak menampung dana', { exact: true }),
    ).toBeVisible();
    const kpi = page.getByRole('region', { name: 'Indikator pembayaran' });
    await expect(kpi.getByText('Rp 48,62 jt')).toBeVisible();

    const daftar = page.getByRole('region', { name: 'Daftar transaksi' });
    await expect(daftar.getByText('Menampilkan 10 dari 10 transaksi contoh', { exact: false })).toBeVisible();
    await daftar.getByRole('button', { name: /Ny\. Endang Wijaya/ }).click();
    const detail = page.getByRole('complementary', { name: 'Detail transaksi' });
    await expect(detail.getByText('INV-2610-02217 · Rp 250.400', { exact: true })).toBeVisible();
    await detail.getByRole('button', { name: 'Simulasikan pembayaran (webhook TPDI)' }).click();
    await expect(
      page.getByText(/Webhook TPDI diterima, tagihan lunas · \d{2}\.\d{2} \(simulasi, tidak disimpan\)/),
    ).toBeVisible();
    await expect(detail.getByText('✓ HMAC valid').first()).toBeVisible();

    // Callback ganda: tercatat tetapi diabaikan (idempoten).
    await daftar.getByRole('button', { name: /Tn\. Sutan Batubara/ }).click();
    await expect(detail.getByText('duplikat · diabaikan')).toBeVisible();
    await expect(detail.getByText('Dikreditkan sekali per event id: Rp 5.000.000')).toBeVisible();

    await page.getByRole('tab', { name: /^Rekonsiliasi\s*3 selisih$/ }).click();
    const rekon = page.getByRole('region', { name: 'Rekonsiliasi tiga arah' });
    const baris = rekon.getByRole('listitem').filter({ hasText: 'Tn. Fajar Nugraha' });
    await baris
      .getByRole('combobox', { name: 'Tindakan untuk selisih Tn. Fajar Nugraha' })
      .selectOption('lunas');
    const catatan = baris.getByLabel('Catatan penyelesaian (wajib)');
    const terapkan = baris.getByRole('button', { name: 'Terapkan' });
    await catatan.fill('singkat');
    await expect(terapkan).toBeDisabled();
    await catatan.fill('Dana cocok di laporan TPDI dan mutasi BTN; webhook gagal');
    await expect(terapkan).toBeEnabled();
    await terapkan.click();
    await expect(baris.getByText('Ditangani', { exact: true })).toBeVisible();
    await expect(baris.getByText(/tercatat di jejak audit/)).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Rekonsiliasi\s*2 selisih$/ })).toBeVisible();
    // Pindah tab tidak menghapus penyelesaian yang sudah dicatat di layar ini.
    await page.getByRole('tab', { name: /^Transaksi/ }).click();
    await page.getByRole('tab', { name: /^Rekonsiliasi/ }).click();
    await expect(baris.getByText('Ditangani', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('pembiayaan BTN', () => {
  test('pencairan piutang BPJS dan tahap cicilan pasien sampai dicairkan', async ({ page }) => {
    const akuntan = await createAccount({ roles: ['akuntan'] });
    await loginAs(page, akuntan, '/keuangan/pembiayaan');
    await expect(
      page.getByRole('heading', { name: 'Pembiayaan BTN · fasilitas kesehatan (simulasi)', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Indikator fasilitas' }).getByText('Rp 15,00 M'),
    ).toBeVisible();

    // Tab A: dua batch layak bayar terpilih → ajukan → disetujui → cair.
    const pool = page.getByRole('region', { name: 'Pool klaim BPJS' });
    await pool.getByRole('button', { name: 'Ajukan pencairan' }).click();
    await expect(pool.getByText(/Pengajuan PCR-2610-01/)).toBeVisible();
    // Mockup: tiap langkah bertanda jam, langkah berikutnya "menunggu", dasar klaim beserta nilainya.
    await expect(pool.getByText(/dasar: .+ · Rp [\d.,]+ (M|jt)/)).toBeVisible();
    await expect(pool.getByText(/^pukul \d{2}\.\d{2}$/)).toHaveCount(1);
    await expect(pool.getByText('menunggu', { exact: true })).toBeVisible();
    // Pengajuan berikutnya tertahan, alasan tetap terbaca (aria-disabled).
    const ajukan = pool.getByRole('button', { name: 'Ajukan pencairan' });
    await expect(ajukan).toBeDisabled();
    await expect(pool.getByText('Selesaikan pengajuan PCR-2610-01 dulu.')).toBeVisible();
    await pool.getByRole('button', { name: 'Simulasi: BTN menyetujui' }).click();
    await pool.getByRole('button', { name: 'Simulasi: BTN mencairkan dana' }).click();
    await expect(
      pool.getByText(/Rp 3\.690\.000\.000 masuk rekening operasional ••••4417 pukul \d{2}\.\d{2}/),
    ).toBeVisible();

    // Tab B: Diajukan → Verifikasi BTN → Disetujui → Akad TTE → Dicairkan.
    await page.getByRole('tab', { name: /^B · Cicilan biaya pasien/ }).click();
    const daftar = page.getByRole('region', { name: 'Daftar pengajuan cicilan' });
    const detail = page.getByRole('region', { name: 'Detail pengajuan' });
    await daftar.getByRole('button', { name: /Ny\. Wulan Sari Dewi/ }).click();
    await expect(detail.getByText('Diajukan', { exact: true })).toBeVisible();
    const steps: Array<[string, string]> = [
      ['Simulasi: teruskan ke verifikasi BTN', 'Verifikasi BTN'],
      ['Simulasi: BTN menyetujui', 'Disetujui'],
      ['Simulasi: pasien tanda tangan akad (TTE)', 'Akad TTE'],
      ['Simulasi: BTN mencairkan dana', 'Dicairkan'],
    ];
    for (const [button, chip] of steps) {
      await detail.getByRole('button', { name: button }).click();
      await expect(detail.getByText(chip, { exact: true })).toBeVisible();
    }
    await expect(detail.getByText(/✓ BTN mencairkan Rp 14\.200\.000/)).toBeVisible();
    await expect(
      detail.getByRole('link', { name: 'Lihat penerimaan di Pembayaran via BTN' }),
    ).toHaveAttribute('href', '/keuangan/pembayaran');

    // Penolakan wajib beralasan (≥ 10 karakter).
    await daftar.getByRole('button', { name: /Tn\. Fajar Nugraha/ }).click();
    await detail.getByRole('button', { name: 'Tolak' }).click();
    const tolak = detail.getByRole('button', { name: 'Konfirmasi tolak' });
    await detail.getByLabel('Alasan penolakan dari BTN (wajib)').fill('kurang');
    await expect(tolak).toBeDisabled();
    // Klik saat alasan kurang menampilkan galat (mockup: aria-disabled, bukan tombol mati). Playwright menganggap
    // aria-disabled "tidak aktif", jadi klik dipaksa seperti klik pengguna sungguhan.
    await tolak.click({ force: true });
    await expect(detail.getByText('Alasan wajib diisi, minimal 10 karakter.')).toBeVisible();
    await expect(detail.getByLabel('Alasan penolakan dari BTN (wajib)')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await detail
      .getByLabel('Alasan penolakan dari BTN (wajib)')
      .fill('Slip gaji tidak dapat diverifikasi BTN');
    await tolak.click();
    await expect(detail.getByText(/✕ Ditolak BTN: Slip gaji tidak dapat diverifikasi BTN/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
