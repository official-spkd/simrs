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
    await expect(dlq.getByRole('status')).toContainText('Perubahan demo tersimpan atas nama');
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
    await expect(page.getByText(/transaksi lokal disinkronkan berurutan tanpa duplikasi/)).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });

  test('logistik: item tercentang seperti mockup, PO terbuka terkunci, usulan wajib berisi item, ajukan (simulasi)', async ({
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
    await expect(incidents).toContainText('RM 00-07-61-33');
    await expect(incidents).not.toContainText('Endang');
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
    const glucose = phone.getByRole('region', { name: 'Gula darah' });
    await glucose.getByRole('button', { name: 'Catat hasil hari ini' }).click();
    await glucose.getByLabel('Hasil gula darah (mg/dL)').fill('65');
    await glucose.getByRole('button', { name: 'Simpan' }).click();
    await expect(glucose).toContainText('di bawah sasaran');
    await expect(glucose.getByRole('alert')).toContainText('Gula darah rendah');
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

    // Mockup AppDokter: Profil → Keluar (hanya pratinjau ponsel) → Masuk lagi.
    await doctor.getByRole('button', { name: 'Profil' }).click();
    await doctor.getByRole('button', { name: 'Keluar' }).click();
    await expect(doctor.getByRole('status')).toHaveText('Anda sudah keluar dari aplikasi dokter');
    await doctor.getByRole('button', { name: 'Masuk lagi' }).click();
    await expect(doctor.getByRole('region', { name: 'Daftar pasien' })).toBeVisible();
  });

  test('pratinjau aplikasi pasien: antrean maju sampai giliran mengirim notifikasi (mockup AppPasien)', async ({
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
    const advance = queue.getByRole('button', { name: 'Simulasi antrean maju satu pasien' });
    for (let i = 0; i < 20 && (await advance.count()) > 0; i++) await advance.click();
    await expect(advance).toHaveCount(0);
    await expect(queue).toContainText('Giliran Anda.');

    await phone.getByRole('button', { name: 'Notifikasi' }).click();
    const notif = phone.getByRole('region', { name: 'Notifikasi' });
    await expect(notif.getByText('Giliran Anda dipanggil')).toBeVisible();
    await expect(notif.getByText('SEP terbit, antrean poli aktif')).toBeVisible();
  });
});
