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
