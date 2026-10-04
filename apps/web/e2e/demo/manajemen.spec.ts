import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/** Integrasi, logistik, mutu, dan pratinjau aplikasi pasien/dokter (mode presentasi, ADR-0023). */

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
    await expect(dlq.getByText('Tujuan: PACS radiologi · 1 pesan')).toBeVisible();
    await expect(dlq.getByLabel('Payload galat')).toContainText('RAD-2610-117');

    await page.getByRole('button', { name: 'Uji mode downtime' }).click();
    await expect(page.getByText(/Mode downtime aktif sejak/)).toBeVisible();
    await expect(cards.getByRole('button', { name: /SATUSEHAT/ })).toContainText('Antre lokal');
    await expect(dlq.getByText(/Ditahan selama uji downtime/)).toBeVisible();
    await page.getByRole('button', { name: 'Pulihkan' }).click();
    await expect(page.getByText(/Koneksi pulih pukul/)).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });

  test('logistik: Buat usulan PO nonaktif sampai item dipilih, draf PO, ajukan (simulasi)', async ({
    page,
  }) => {
    const direksi = await createAccount({ roles: ['manajemen'] });
    await loginAs(page, direksi, '/');
    await page.goto('/manajemen/logistik');
    await expect(
      page.getByRole('heading', { name: 'Rantai pasok · stok dan pengadaan', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Indikator logistik' }).getByText('Rp 4,82 M'),
    ).toBeVisible();

    const make = page.getByRole('button', { name: /^Buat usulan PO/ });
    await expect(make).toBeDisabled();
    await expect(page.getByText('Centang item dulu untuk membuat usulan.')).toBeVisible();

    const table = page.getByRole('region', { name: 'Item di bawah titik pesan ulang' });
    await expect(table.getByText('Kritis · 4 hari').filter({ visible: true }).first()).toBeVisible();
    await table.getByRole('checkbox', { name: 'Masukkan Enoksaparin 60 mg/0,6 mL ke usulan PO' }).check();
    await expect(make).toBeEnabled();
    await make.click();

    const draft = page.getByRole('region', { name: 'Draf usulan PO-2610-032' });
    await expect(draft).toContainText('Rp 41.400.000');
    await draft.getByRole('button', { name: 'Ajukan ke direktur' }).click();
    await expect(
      page.getByText(/Usulan PO-2610-032 diajukan ke direktur .*\(simulasi, tidak disimpan\)/),
    ).toBeVisible();
    await expect(table.getByText('Masuk PO-2610-032').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Pengadaan berjalan' })).toContainText('PO-2610-032');

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
    await expect(incidents).toContainText('RM 00-58-02-41');
    await expect(incidents).not.toContainText('Lestiani');
    await expect(page.getByRole('table', { name: /Matriks risiko/ })).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });

  test('pratinjau aplikasi pasien dan dokter di kanvas ponsel berskala; posisi lain ditolak', async ({
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
    await phone.getByRole('button', { name: /Hasil lab/ }).click();
    await expect(phone.getByRole('heading', { name: 'Hasil lab' })).toBeVisible();
    await expect(phone.getByText('Belum ada hasil yang dirilis untuk Anda.')).toBeVisible();

    await page.goto('/pratinjau/aplikasi-dokter');
    const doctor = page.getByRole('region', { name: 'Pratinjau aplikasi dokter' });
    await expect(doctor).toHaveAttribute('data-scale', /\d/);
    const critical = doctor.getByRole('alert', { name: 'Nilai kritis' });
    await expect(critical).toContainText('Kalium 6,8 mmol/L');
    const readback = critical.getByRole('button', { name: 'Read-back benar' });
    await expect(readback).toBeDisabled();
    await critical.getByLabel(/dibacakan ulang/).fill('6,8');
    await expect(readback).toBeEnabled();
    await readback.click();
    await expect(doctor.getByRole('status', { name: 'Nilai kritis' })).toContainText('read-back tercatat');
  });
});
