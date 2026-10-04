import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/** Layar penunjang mode presentasi (ADR-0023): laboratorium, farmasi, radiologi. */

async function jumpTo(page: Page, scenarioTab: string | null, stage: string) {
  await page.goto('/simulasi');
  if (scenarioTab) await page.getByRole('tab', { name: scenarioTab }).click();
  await page.getByText('Lompat ke tahap', { exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^\\d+\\. ${stage}$`) }).click();
  await expect(page.getByText(new RegExp(`Langkah \\d+ dari \\d+ · ${stage}`))).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('penunjang · laboratorium', () => {
  test('worklist dan hasil ber-LOINC; nilai kritis wajib penerima dan read-back; validasi berurutan', async ({
    page,
  }) => {
    const analis = await createAccount({ roles: ['analis_lab'] });
    await loginAs(page, analis, '/penunjang/lab');
    await expect(
      page.getByRole('heading', { name: 'Laboratorium · validasi hasil', level: 1 }),
    ).toBeVisible();
    const worklist = page.getByRole('region', { name: 'Worklist' });
    await expect(worklist.getByText('L2610050142')).toBeVisible();

    await worklist.getByRole('button', { name: /Ny\. Endang Wijaya/ }).click();
    await expect(page).toHaveURL(/pilih=lab-endang/);
    const hasil = page.getByRole('region', { name: 'Hasil pemeriksaan' });
    await expect(hasil.getByText('LOINC 2160-0')).toBeVisible();
    await expect(hasil.getByRole('row', { name: /Kreatinin/ })).toContainText('H Δ');

    // Nilai kritis: tidak bisa disimpan tanpa penerima dan read-back.
    const kritis = page.getByRole('region', { name: /Nilai kritis terbuka · Tn\. Yusuf Hidayat/ });
    await expect(kritis.getByRole('timer')).toHaveText(/^\d{2}:\d{2}$/);
    await kritis.getByRole('button', { name: 'Catat pelaporan' }).click();
    await kritis.getByRole('button', { name: 'Simpan pelaporan' }).click();
    await expect(kritis.getByText('Nama penerima wajib diisi (minimal 5 karakter).')).toBeVisible();
    await expect(kritis.getByText('Read-back wajib dikonfirmasi sebelum disimpan.')).toBeVisible();
    await kritis
      .getByRole('textbox', { name: 'Nama penerima laporan (DPJP / dokter jaga)' })
      .fill('dr. Sinta Maharani, Sp.PD-KGH');
    await kritis.getByRole('button', { name: 'Simpan pelaporan' }).click();
    await expect(kritis.getByText('Read-back wajib dikonfirmasi sebelum disimpan.')).toBeVisible();
    const kpi = page.getByRole('region', { name: 'Indikator laboratorium' });
    await expect(kpi.getByText('belum dilaporkan dengan read-back')).toBeVisible();
    await kritis.getByRole('checkbox', { name: /Read-back/ }).check();
    await kritis.getByRole('button', { name: 'Simpan pelaporan' }).click();
    const dilaporkan = page.getByRole('region', { name: /Nilai kritis dilaporkan · Tn\. Yusuf Hidayat/ });
    await expect(dilaporkan).toContainText('read-back terkonfirmasi');
    await expect(dilaporkan).toContainText('(simulasi, tidak disimpan)');
    await expect(kpi.getByText('semua sudah dilaporkan')).toBeVisible();

    // Validasi teknis lalu klinis (TTE Sp.PK).
    await worklist.getByRole('button', { name: /Ny\. Endang Wijaya/ }).click();
    await hasil.getByRole('button', { name: 'Validasi teknis' }).click();
    await expect(hasil.getByText(/Validasi teknis tersimpan pukul \d{2}\.\d{2}/)).toBeVisible();
    await hasil.getByRole('button', { name: 'Validasi klinis (TTE Sp.PK)' }).click();
    await expect(hasil.getByText(/Validasi klinis selesai pukul \d{2}\.\d{2}/)).toBeVisible();
    await expect(hasil.getByRole('button', { name: 'Tervalidasi' })).toBeDisabled();
  });

  test('skenario IGD: hasil kritis Tn. Hartono dilaporkan dengan read-back dari layar Lab', async ({
    page,
  }) => {
    const analis = await createAccount({ roles: ['analis_lab'] });
    await loginAs(page, analis, '/simulasi');
    await jumpTo(page, 'IGD → rawat inap', 'Lab & nilai kritis');
    await page.goto('/penunjang/lab');
    const worklist = page.getByRole('region', { name: 'Worklist' });
    await worklist.getByRole('button', { name: /Tn\. Hartono Wibisono/ }).click();
    await page
      .getByRole('region', { name: 'Hasil pemeriksaan' })
      .getByRole('button', { name: 'Buka hasil' })
      .click();
    const kritis = page.getByRole('region', { name: /Nilai kritis terbuka · Tn\. Hartono Wibisono/ });
    await expect(kritis).toContainText('Kalium 6,8 mmol/L');
    await kritis.getByRole('button', { name: 'Catat pelaporan' }).click();
    await kritis
      .getByRole('textbox', { name: 'Nama penerima laporan (DPJP / dokter jaga)' })
      .fill('dr. Rina Kusuma (dokter jaga IGD)');
    await kritis.getByRole('checkbox', { name: /Read-back/ }).check();
    await kritis.getByRole('button', { name: 'Simpan pelaporan' }).click();
    const dilaporkan = page.getByRole('region', { name: /Nilai kritis dilaporkan · Tn\. Hartono Wibisono/ });
    await expect(dilaporkan).toContainText('waktu lapor 5 menit');
  });

  test('tablet 768 px tanpa scroll horizontal', async ({ page }) => {
    const analis = await createAccount({ roles: ['analis_lab'] });
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginAs(page, analis, '/penunjang/lab?pilih=lab-endang');
    await expect(page.getByRole('region', { name: 'Hasil pemeriksaan' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
