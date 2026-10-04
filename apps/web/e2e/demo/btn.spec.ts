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

    const insisi = page.getByRole('button', { name: 'Mulai insisi', exact: true });
    await expect(insisi).toBeDisabled();
    await expect(page.getByText('Insisi terkunci: time out belum lengkap')).toBeVisible();

    // Override darurat menuntut alasan klinis minimal 15 karakter.
    await page.getByRole('button', { name: 'Mulai insisi tanpa time out lengkap (darurat)' }).click();
    await page.getByLabel(/Alasan klinis/).fill('darurat');
    await expect(page.getByRole('button', { name: 'Simpan alasan dan lanjut' })).toBeDisabled();
    await page.getByRole('button', { name: 'Batal' }).click();

    const tilik = page.getByRole('region', { name: 'Daftar tilik keselamatan' });
    await tilik
      .getByRole('checkbox', { name: 'Antisipasi kejadian kritis (bedah, anestesi, perawat)' })
      .check();
    await tilik.getByRole('checkbox', { name: 'Pencitraan penting ditampilkan' }).check();
    await expect(insisi).toBeDisabled();
    await tilik.getByRole('button', { name: 'Konfirmasi time out' }).click();
    await expect(tilik.getByText(/Time out dikonfirmasi oleh .* \(simulasi, tidak disimpan\)/)).toBeVisible();
    await expect(insisi).toBeEnabled();
    await insisi.click();
    await expect(page.getByText(/✓ Insisi dicatat \d{2}\.\d{2}/)).toBeVisible();

    // Kasus lain lewat Gantt: blok terjadwal belum punya daftar tilik yang terisi.
    await jadwal.getByRole('button', { name: /Ny\. Wulan Sari Dewi/ }).click();
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
      page.getByRole('region', { name: 'Alur dana' }).getByText('tidak menampung dana'),
    ).toBeVisible();
    const kpi = page.getByRole('region', { name: 'Indikator pembayaran' });
    await expect(kpi.getByText('Rp 48,62 jt')).toBeVisible();

    const daftar = page.getByRole('region', { name: 'Daftar transaksi' });
    await expect(daftar.getByText('Menampilkan 10 dari 10 transaksi contoh', { exact: false })).toBeVisible();
    await daftar.getByRole('button', { name: /Ny\. Endang Wijaya/ }).click();
    const detail = page.getByRole('complementary', { name: 'Detail transaksi' });
    await expect(detail.getByText('INV-2610-02217', { exact: false })).toBeVisible();
    await detail.getByRole('button', { name: 'Simulasikan pembayaran (webhook TPDI)' }).click();
    await expect(
      page.getByText(/Webhook TPDI diterima, tagihan lunas · \d{2}\.\d{2} \(simulasi, tidak disimpan\)/),
    ).toBeVisible();
    await expect(detail.getByText('✓ HMAC valid').first()).toBeVisible();

    // Callback ganda: tercatat tetapi diabaikan (idempoten).
    await daftar.getByRole('button', { name: /Tn\. Sutan Batubara/ }).click();
    await expect(detail.getByText('duplikat · diabaikan')).toBeVisible();
    await expect(detail.getByText('Dikreditkan sekali per event id: Rp 5.000.000')).toBeVisible();

    await page.getByRole('tab', { name: /Rekonsiliasi · 3 selisih/ }).click();
    const rekon = page.getByRole('region', { name: 'Rekonsiliasi tiga arah' });
    const baris = rekon.getByRole('listitem').filter({ hasText: 'Tn. Darmawan Putra' });
    await baris
      .getByRole('combobox', { name: 'Tindakan untuk selisih Tn. Darmawan Putra' })
      .selectOption('lunas');
    const catatan = baris.getByLabel('Catatan penyelesaian (wajib)');
    const terapkan = baris.getByRole('button', { name: 'Terapkan' });
    await catatan.fill('singkat');
    await expect(terapkan).toBeDisabled();
    await catatan.fill('Dana cocok di laporan TPDI dan mutasi BTN; webhook gagal');
    await expect(terapkan).toBeEnabled();
    await terapkan.click();
    await expect(baris.getByText('Ditangani')).toBeVisible();
    await expect(baris.getByText(/tercatat di jejak audit/)).toBeVisible();
    await expect(page.getByRole('tab', { name: /Rekonsiliasi · 2 selisih/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
