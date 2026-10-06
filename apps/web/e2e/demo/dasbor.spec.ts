import { expect, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/** Dasbor direksi (mode presentasi, ADR-0023; mockup Dasbor). */
test.describe('dasbor direksi', () => {
  test('KPI per rentang, tanda tindak lanjut, tanpa scroll horizontal', async ({
    page,
    viewport,
  }, testInfo) => {
    const direksi = await createAccount({ roles: ['manajemen'] });
    await loginAs(page, direksi, '/');
    if ((viewport?.width ?? 1280) >= 768) {
      await page
        .getByRole('navigation', { name: 'Navigasi utama' })
        .getByRole('link', { name: 'Dasbor eksekutif' })
        .click();
    } else {
      await page.goto('/manajemen/dasbor');
    }
    await expect(
      page.getByRole('heading', { name: 'Kinerja rumah sakit · Oktober 2026', level: 1 }),
    ).toBeVisible();
    const kpi = page.getByRole('region', { name: 'Indikator kinerja utama' });
    await expect(kpi.getByText('1.148', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /Grafik pendapatan harian/ })).toBeVisible();

    await page.getByRole('radio', { name: 'Hari ini' }).click();
    await expect(page.getByRole('radio', { name: 'Hari ini' })).toHaveAttribute('aria-checked', 'true');
    await expect(
      page.getByRole('heading', { name: 'Kinerja rumah sakit · hari ini', level: 1 }),
    ).toBeVisible();
    await expect(kpi.getByText('736', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/periode=hari-ini/);

    const alerts = page.getByRole('region', { name: 'Perlu keputusan direksi' });
    await expect(alerts.getByText('4 terbuka')).toBeVisible();
    await alerts.getByRole('button', { name: 'Tandai ditindaklanjuti' }).first().click();
    await expect(alerts.getByText('3 terbuka')).toBeVisible();
    await expect(
      alerts.getByText(/Ditindaklanjuti \d{2}\.\d{2} · .* · tercatat di log direksi/),
    ).toBeVisible();
    await expect(page.getByText(/simulasi/)).toHaveCount(0);
    // Tanda tersimpan di toko demo (bukan penyimpanan sesi peramban): bertahan setelah muat ulang.
    await page.reload();
    await expect(alerts.getByText('3 terbuka')).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('dasbor.png'), fullPage: true });
  });

  test('mengalir dari Logistik: PO darurat enoksaparin diterima → butir stok hilang dari keputusan direksi', async ({
    page,
  }) => {
    const direksi = await createAccount({ roles: ['manajemen'] });
    await loginAs(page, direksi, '/');
    await page.goto('/manajemen/dasbor?periode=hari-ini');
    const alerts = page.getByRole('region', { name: 'Perlu keputusan direksi' });
    await expect(alerts).toContainText('Stok enoksaparin 4 hari (< 7)');
    await expect(alerts).toContainText('PO darurat menunggu persetujuan.');
    await expect(alerts).toContainText(/ICU 92% · \d+ pasien IGD menunggu/);

    await page.goto('/manajemen/logistik');
    const enox = page
      .getByRole('region', { name: 'Pengadaan berjalan' })
      .getByRole('listitem', { name: /PO-2610-031/ });
    await enox.getByRole('button', { name: 'Setujui PO-2610-031' }).click();
    await expect(enox).toContainText('Disetujui direktur');
    await page.goto('/manajemen/dasbor?periode=hari-ini');
    await expect(alerts).toContainText('PO darurat disetujui, menunggu barang.');

    await page.goto('/manajemen/logistik');
    await enox.getByRole('button', { name: 'Terbitkan PO PO-2610-031' }).click();
    await expect(enox).toContainText('PO terbit');
    await enox.getByRole('button', { name: 'Konfirmasi dikirim pemasok PO-2610-031' }).click();
    await enox.getByRole('button', { name: 'Terima barang PO-2610-031' }).click();
    const gr = page.getByRole('region', { name: 'Penerimaan barang PO-2610-031' });
    await gr.getByLabel('Batch Enoksaparin 60 mg/0,6 mL').fill('ENX2610B');
    await gr.getByLabel('Kedaluwarsa Enoksaparin 60 mg/0,6 mL').fill('2028-06-30');
    await gr.getByRole('button', { name: 'Catat penerimaan' }).click();
    await expect(enox).toContainText('Diterima GRN-2610-0145');

    await page.goto('/manajemen/dasbor?periode=hari-ini');
    await expect(alerts).not.toContainText('enoksaparin');
    await expect(alerts.getByText('3 terbuka')).toBeVisible();
  });

  test('posisi lain: menu tersembunyi dan layar menjelaskan posisi pemakainya', async ({
    page,
    viewport,
  }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/');
    if ((viewport?.width ?? 1280) >= 768) {
      await expect(
        page.getByRole('navigation', { name: 'Navigasi utama' }).getByText('Dasbor eksekutif'),
      ).toHaveCount(0);
    }
    await page.goto('/manajemen/dasbor');
    await expect(page.getByText('Layar ini untuk posisi lain')).toBeVisible();
    await expect(page.getByText(/dipakai oleh posisi: Manajemen/)).toBeVisible();
  });
});
