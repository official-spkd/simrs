import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/** Pemeriksaan poli (K01/K02) dan CPOE + CDS (K09) — mode presentasi, ADR-0023; mockup Main dan CPOE. */

async function noHorizontalOverflowAtTablet(page: Page) {
  await page.setViewportSize({ width: 768, height: 1024 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const banner = (page: Page) => page.locator('[aria-label="Identitas pasien"]');

/** Lompat skenario Simulasi aktif (rawat jalan) ke tahap `stage` lewat "Lompat ke tahap". */
async function jumpTo(page: Page, stage: string) {
  await page.goto('/simulasi');
  await page.getByText('Lompat ke tahap', { exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^\\d+\\. ${stage}$`) }).click();
  await expect(page.getByText(new RegExp(`Langkah \\d+ dari \\d+ · ${stage}`))).toBeVisible();
}

test.describe('klinis rawat jalan', () => {
  test('poli: antrean, banner pasien dengan alergi, tanda vital, tanda tangan butuh diagnosis', async ({
    page,
  }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, '/klinis/poli');
    await page.goto('/klinis/poli');
    await expect(page.getByRole('heading', { name: 'Pemeriksaan pasien', level: 1 })).toBeVisible();

    const queue = page.getByRole('region', { name: 'Antrean poli' });
    await expect(queue.getByRole('link')).toHaveCount(5);
    await expect(queue.getByRole('button', { name: 'Panggil berikutnya · PD-026' })).toBeEnabled();
    await queue.getByLabel('Cari pasien').fill('00315746');
    await expect(queue.getByRole('link')).toHaveCount(1);
    await expect(queue.getByRole('link', { name: /Ny\. Sri Wahyuni/ })).toBeVisible();
    await queue.getByLabel('Cari pasien').fill('');
    await queue.getByRole('button', { name: 'Hasil 1' }).click();
    await expect(queue.getByRole('link')).toHaveCount(1);
    await expect(queue.getByRole('link', { name: /Ny\. Dewi Kurniasih/ })).toContainText('Menunggu hasil');
    await queue.getByRole('button', { name: 'Semua 5' }).click();
    await queue.getByRole('link', { name: /Ny\. Rohana Siregar/ }).click();
    await expect(page).toHaveURL(/pasien=ps-rohana/);

    await expect(banner(page).getByText('Ny. Rohana Siregar')).toBeVisible();
    await expect(banner(page).getByText('Alergi: Amoksisilin')).toBeVisible();
    await expect(page.getByText(/^NIK 9999•+\d{4}$/)).toBeVisible();
    const vitals = page.getByRole('region', { name: 'Tanda vital' });
    await expect(vitals.getByText('TANDA VITAL · diukur perawat 07.36')).toBeVisible();
    await expect(vitals.getByText('132/84').first()).toBeVisible();

    const sign = page.getByRole('button', { name: 'Tanda tangani dan selesai' });
    await expect(sign).toBeDisabled();
    await expect(
      page.getByText('Isi minimal satu diagnosis (A · Asesmen ICD-10) agar kunjungan bisa diselesaikan.'),
    ).toBeVisible();
    await page.getByRole('button', { name: '+ Tambah diagnosis' }).click();
    await page.getByLabel('Pilih kode ICD-10').selectOption('E11.9');
    await expect(page.getByText('Diabetes melitus tipe 2 tanpa komplikasi').first()).toBeVisible();
    await expect(sign).toBeEnabled();
    await sign.click();
    await expect(
      page.getByText(/Ditandatangani \d{2}\.\d{2} · CPPT versi final \(simulasi, tidak disimpan\)/),
    ).toBeVisible();
    await expect(page.getByText(/Kunjungan selesai · ditandatangani \d{2}\.\d{2}/)).toBeVisible();
    await expect(queue.getByRole('link', { name: /Ny\. Rohana Siregar/ })).toContainText('Selesai');

    await noHorizontalOverflowAtTablet(page);
  });

  test('CPOE: amoksisilin diblokir CDS sampai alasan override ≥ 10 karakter; kirim tertahan dengan alasan', async ({
    page,
  }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, '/klinis/order/kj-rohana');
    await page.goto('/klinis/order/kj-rohana');
    await expect(page.getByRole('heading', { name: 'Order & resep (CPOE)', level: 1 })).toBeVisible();
    await expect(banner(page).getByText('Alergi: Amoksisilin')).toBeVisible();

    const send = page.getByRole('button', { name: /^Kirim \d+ order \(TTE\)$/ });
    await expect(send).toBeEnabled();
    await page.getByLabel('Cari pemeriksaan, obat, tindakan').fill('amoksisilin');
    await page.getByRole('button', { name: /Tambah Amoksisilin 500 mg kapsul/ }).click();

    const gate = page.getByRole('alert').filter({ hasText: 'CDS memblokir Amoksisilin 500 mg kapsul' });
    await expect(gate).toContainText('pasien alergi amoksisilin');
    await expect(send).toBeDisabled();
    await expect(page.getByText(/Belum bisa dikirim: 1 order diblokir CDS \(amoksisilin\)/)).toBeVisible();

    await gate.getByRole('button', { name: 'Override dengan alasan' }).click();
    const reason = gate.getByLabel(/Alasan klinis/);
    await reason.fill('ruam');
    await expect(gate.getByRole('button', { name: 'Simpan alasan dan lanjut' })).toBeDisabled();
    await reason.fill('Ruam ringan 10 tahun lalu, uji kulit negatif');
    await gate.getByRole('button', { name: 'Simpan alasan dan lanjut' }).click();
    await expect(page.getByText(/Override alergi oleh .+ · alasan: Ruam ringan 10 tahun lalu/)).toBeVisible();

    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByText(/^5 order terkirim pukul \d{2}\.\d{2}$/)).toBeVisible();

    await noHorizontalOverflowAtTablet(page);
  });

  test('CPOE: alternatif aman membuka blok (Tn. Darmawan, alergi ibuprofen); kunjungan tak dikenal 404', async ({
    page,
  }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, '/klinis/order/kj-darmawan');
    await page.goto('/klinis/order/kj-darmawan');
    const send = page.getByRole('button', { name: /^Kirim \d+ order \(TTE\)$/ });
    await expect(send).toBeDisabled();
    const gate = page.getByRole('alert').filter({ hasText: 'CDS memblokir Asam mefenamat 500 mg tablet' });
    await gate.getByRole('button', { name: 'Ganti parasetamol 500 mg' }).click();
    await expect(page.getByText(/asam mefenamat 500 mg diganti parasetamol 500 mg/)).toBeVisible();
    await expect(send).toBeEnabled();

    const res = await page.goto('/klinis/order/kj-tidak-ada');
    expect(res?.status()).toBe(404);
  });

  test('perawat: asesmen tanda vital tervalidasi; CPOE hanya untuk dokter', async ({ page }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/klinis/poli?pasien=ps-darmawan');
    await page.goto('/klinis/poli?pasien=ps-darmawan');
    await expect(banner(page).getByText('Alergi: Ibuprofen')).toBeVisible();
    await expect(page.getByText(/CPPT dokter hanya bisa diubah posisi dokter/)).toBeVisible();
    // Order dan resep hanya untuk posisi dokter: perawat tidak melihat tautan CPOE di rencana.
    await expect(page.getByRole('link', { name: 'Tulis resep (CPOE)' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Ukur ulang tanda vital' }).click();
    await page.getByLabel('Tekanan darah (mmHg)').fill('15096');
    await page.getByRole('button', { name: 'Simpan tanda vital' }).click();
    await expect(page.getByText('Isi dengan format sistolik/diastolik, mis. 120/80.')).toBeVisible();
    await page.getByLabel('Tekanan darah (mmHg)').fill('150/96');
    await page.getByRole('button', { name: 'Simpan tanda vital' }).click();
    await expect(
      page.getByText(/Tanda vital tersimpan \d{2}\.\d{2} \(simulasi, tidak disimpan\)/),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Tanda vital' }).getByText('Tinggi', { exact: true }),
    ).toBeVisible();

    await page.goto('/klinis/order/kj-darmawan');
    await expect(page.getByText('Layar ini untuk posisi lain')).toBeVisible();
  });

  test('CPOE pasien skenario (Tn. Suryo, langkah resep): katalog terkunci, kirim hanya lewat tugas skenario', async ({
    page,
  }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, '/simulasi');
    await jumpTo(page, 'Tinjau hasil & resep');
    await page.goto('/klinis/order/kj-suryo');
    await expect(page.getByRole('heading', { name: 'Order & resep (CPOE)', level: 1 })).toBeVisible();

    // Katalog dan order set nonaktif dengan catatan tertulis: item tidak bisa ditambahkan lokal.
    const catalog = page.getByRole('complementary', { name: 'Katalog dan order set' });
    await expect(catalog.getByText('Pasien simulasi: order mengikuti langkah skenario.')).toBeVisible();
    await expect(catalog.getByLabel('Cari pemeriksaan, obat, tindakan')).toBeDisabled();
    for (const set of await catalog
      .getByRole('region', { name: 'Order set institusi' })
      .getByRole('button')
      .all())
      await expect(set).toBeDisabled();

    // Hanya kirim skenario (TTE), belum bisa sebelum rencana terapi dan PRB; tidak ada kirim order biasa.
    const send = page.getByRole('button', { name: 'Kirim resep (TTE)' });
    await expect(send).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Kirim \d+ order \(TTE\)$/ })).toHaveCount(0);

    const plan = page.getByRole('region', { name: 'Rencana tata laksana' });
    await plan.getByRole('button', { name: /Metformin \+ atorvastatin/ }).click();
    const list = page.getByRole('region', { name: 'Daftar order' });
    await expect(list.getByText('Draf skenario').first()).toBeVisible();
    await expect(list.getByRole('button', { name: /^Hapus / })).toHaveCount(0);

    await plan.getByRole('button', { name: /Tidak · resep 7 hari/ }).click();
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByText(/^Resep terkirim · \d{2}\.\d{2}$/)).toBeVisible();
  });
});
