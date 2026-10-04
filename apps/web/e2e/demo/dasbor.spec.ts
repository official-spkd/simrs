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
    await expect(alerts.getByText(/Ditindaklanjuti \d{2}\.\d{2}/)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('dasbor.png'), fullPage: true });
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
