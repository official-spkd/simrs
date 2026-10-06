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
    await expect(detail.getByRole('status').filter({ hasText: 'read-back terkonfirmasi' })).toContainText(
      '(simulasi, tidak disimpan)',
    );
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
    await expect(page.getByRole('status').filter({ hasText: '10 dari CFX2510' })).toContainText(
      '(simulasi, tidak disimpan)',
    );

    await page.getByRole('tab', { name: 'Stok & kedaluwarsa' }).click();
    const row = page.getByRole('row', { name: /OMZ2509/ });
    await expect(row).toContainText('Kedaluwarsa');
    await row.getByRole('button', { name: 'Pindahkan ke karantina' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'karantina' })).toBeVisible();
    await expect(page.getByRole('row', { name: /OMZ2509/ })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Kartu stok' }).click();
    await expect(page.getByRole('row', { name: /Karantina kedaluwarsa/ })).toBeVisible();
  });
});

test.describe('S08 · bank darah', () => {
  test('crossmatch → cek ganda dua petugas → pindai gelang + kantong → reaksi menghentikan transfusi', async ({
    page,
  }) => {
    const analis = await createAccount({ roles: ['analis_lab'] });
    await loginAs(page, analis, '/penunjang/bank-darah');
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

    // Cek ganda: tanpa butir lengkap dan petugas kedua → ditolak.
    const issue = detail.getByRole('form', { name: 'Cek ganda pengeluaran kantong' });
    await issue.getByRole('button', { name: 'Keluarkan kantong' }).click();
    await expect(detail.getByRole('alert').filter({ hasText: 'dua petugas' })).toBeVisible();
    await issue.getByLabel('Petugas 2 (penerima dari ruangan)').fill('Bd. Wina Kartikasari, S.Tr.Keb');
    await issue.getByRole('button', { name: 'Keluarkan kantong' }).click();
    await expect(detail.getByRole('alert').filter({ hasText: 'butir cek ganda' })).toBeVisible();
    for (const box of await issue.getByRole('checkbox').all()) await box.check();
    await issue.getByRole('button', { name: 'Keluarkan kantong' }).click();
    await expect(
      detail.getByRole('status').filter({ hasText: 'dikeluarkan setelah cek ganda' }),
    ).toBeVisible();

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
    await expect(page.getByRole('status').filter({ hasText: 'skor MST 0' })).toBeVisible();
    await page.getByRole('tab', { name: /Order diet/ }).click();
    await page
      .getByRole('list', { name: 'Order diet dari DPJP' })
      .getByRole('listitem')
      .filter({ hasText: 'An. Raka Pratama' })
      .getByRole('button', { name: 'Verifikasi order' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'diverifikasi' })).toBeVisible();
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
    const analis = await createAccount({ roles: ['analis_lab'] });
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
    await expect(detail.getByText(/Ekspertise ditandatangani dr\. Bagus Santoso/)).toBeVisible();
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
