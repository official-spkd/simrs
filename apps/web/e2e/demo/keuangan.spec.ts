import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/** Keuangan (mode presentasi, ADR-0023; mockup Kasir, Klaim, Akuntansi). */

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('kasir', () => {
  test('total tagihan = jumlah baris yang tampil; bayar QRIS sampai kuitansi', async ({ page }) => {
    const kasir = await createAccount({ roles: ['kasir'] });
    await loginAs(page, kasir, '/keuangan/kasir');
    await page.goto('/keuangan/kasir?pilih=inv-endang');
    await expect(page.getByRole('heading', { name: 'Kasir · tagihan pasien', level: 1 })).toBeVisible();
    await expect(page.getByText('Ny. Endang Wijaya').first()).toBeVisible();
    await expect(page.getByText('INV-2610-02217')).toBeVisible();

    const bill = page.getByRole('region', { name: 'Rincian tagihan' });
    await bill.getByRole('button', { name: 'Buka semua kategori' }).click();
    // Tunggu render terbuka (auto-wait) sebelum membaca baris sekaligus.
    await expect(bill.getByRole('button', { name: 'Tutup semua kategori' })).toBeVisible();
    const sum = await bill
      .locator('[data-line-amount]')
      .evaluateAll((els) =>
        els.reduce((s, e) => s + BigInt(e.getAttribute('data-line-amount') ?? '0'), 0n).toString(),
      );
    const total = await bill.locator('[data-total-amount]').getAttribute('data-total-amount');
    expect(sum).toBe(total);
    await expect(bill.locator('[data-total-amount]')).toHaveText('Rp 18.297.500');
    await expect(page.getByRole('region', { name: 'Pembagian penjamin' })).toContainText('Rp 1.250.400');

    const pay = page.getByRole('region', { name: 'Pembayaran' });
    const finish = pay.getByRole('button', { name: 'Selesaikan dan cetak kuitansi' });
    await expect(finish).toBeDisabled();
    await expect(pay.getByText('Menunggu pembayaran QRIS diterima.')).toBeVisible();
    await pay.getByRole('button', { name: 'Simulasikan pembayaran diterima' }).click();
    await expect(finish).toBeEnabled();
    await finish.click();
    await expect(pay.getByText(/kuitansi KW-2610-02217 · \d{2}\.\d{2}/)).toBeVisible();
    await expect(page.getByText(/\(simulasi, tidak disimpan\)/)).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('item manual diblokir tanpa alasan tertulis', async ({ page }) => {
    const kasir = await createAccount({ roles: ['kasir'] });
    await loginAs(page, kasir, '/keuangan/kasir');
    await page.goto('/keuangan/kasir?pilih=inv-ayu');
    const bill = page.getByRole('region', { name: 'Rincian tagihan' });
    await expect(bill.locator('[data-total-amount]')).toHaveText('Rp 463.500');

    await page.getByRole('button', { name: 'Tambah item manual' }).click();
    const form = page.getByRole('form', { name: 'Tambah item manual' });
    await expect(form.getByLabel('Nama item')).toBeFocused();
    await form.getByLabel('Kuantitas').fill('2.5');
    await expect(form.getByText('Isi bilangan bulat 1–99 tanpa desimal.')).toBeVisible();
    await form.getByLabel('Kuantitas').fill('1');
    await expect(form.getByText('Isi bilangan bulat 1–99 tanpa desimal.')).toHaveCount(0);
    await form.getByLabel('Nama item').fill('Nebulisasi tambahan');
    await form.getByLabel('Harga satuan (Rp)').fill('35000');
    const submit = form.getByRole('button', { name: 'Ajukan item manual' });
    await expect(submit).toBeDisabled();
    await expect(form.getByText(/Belum bisa diajukan: tulis alasan/)).toBeVisible();

    await form.getByLabel(/Alasan item manual/).fill('Tindakan malam hari belum tercatat di eMAR');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(bill.locator('[data-total-amount]')).toHaveText('Rp 498.500');
    await bill.getByRole('button', { name: 'Buka semua kategori' }).click();
    await expect(bill.getByText('Nebulisasi tambahan')).toBeVisible();
    await expect(bill.getByText('Manual', { exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('posisi lain melihat ajakan ganti posisi', async ({ page }) => {
    const kasir = await createAccount({ roles: ['kasir'] });
    await loginAs(page, kasir, '/keuangan/kasir');
    await page.goto('/keuangan/klaim');
    await expect(page.getByText('Layar ini untuk posisi lain')).toBeVisible();
  });
});

test.describe('klaim', () => {
  test('koder membuka berkas: tabel ICD-10/ICD-9-CM, grouper, saran J13 lalu kirim', async ({ page }) => {
    const koder = await createAccount({ roles: ['koder'] });
    await loginAs(page, koder, '/keuangan/klaim');
    await page.goto('/keuangan/klaim?status=draft&pilih=kl-endang');
    await expect(
      page.getByRole('heading', { name: 'Klaim JKN · koding dan grouping', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Indikator klaim' }).getByText('1.284')).toBeVisible();

    const dx = page.getByRole('table', { name: 'Diagnosis ICD-10' });
    const px = page.getByRole('table', { name: 'Prosedur ICD-9-CM' });
    await expect(dx.getByText('J18.9', { exact: true })).toBeVisible();
    await expect(px.getByText('89.65', { exact: true })).toBeVisible();
    const grouper = page.getByRole('region', { name: 'Hasil grouper' });
    await expect(grouper.getByText('J-4-15-II', { exact: true }).first()).toBeVisible();

    const send = page.getByRole('button', { name: 'Final dan kirim E-Klaim' });
    await expect(send).toBeDisabled();
    await expect(page.getByText(/Belum bisa dikirim: lengkapi 1 berkas/)).toBeVisible();

    await page.getByRole('button', { name: 'Terima J13' }).click();
    await expect(dx.getByText('J13', { exact: true })).toBeVisible();
    await page.getByLabel(/Bukti klinis N17\.9 di CPPT/).check();
    await expect(grouper.getByText('J-4-15-III', { exact: true })).toBeVisible();
    await expect(grouper.getByText('Rp 9.104.300')).toBeVisible();

    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByText(/Terkirim ke E-Klaim \d{2}\.\d{2}/)).toBeVisible();
    await noHorizontalOverflow(page);
  });
});

test.describe('akuntansi', () => {
  test('jurnal seimbang, dialog tutup periode menahan sampai syarat terpenuhi', async ({ page }) => {
    const akuntan = await createAccount({ roles: ['akuntan'] });
    await loginAs(page, akuntan, '/keuangan/akuntansi');
    await page.goto('/keuangan/akuntansi');
    await expect(
      page.getByRole('heading', { name: 'Akuntansi · jurnal dan piutang', level: 1 }),
    ).toBeVisible();

    const pairs = await page
      .locator('tbody[data-journal]')
      .evaluateAll((bodies) =>
        bodies.map((b) => [
          b.querySelector('[data-total-debit]')?.getAttribute('data-total-debit') ?? 'x',
          b.querySelector('[data-total-credit]')?.getAttribute('data-total-credit') ?? 'y',
        ]),
      );
    expect(pairs.length).toBeGreaterThanOrEqual(6);
    for (const [d, c] of pairs) expect(d).toBe(c);

    const journals = page.getByRole('region', { name: 'Jurnal otomatis' });
    await journals.getByRole('button', { name: /Logistik/ }).click();
    await expect(journals.locator('tbody[data-journal]')).toHaveCount(2);
    await journals.getByRole('button', { name: 'Semua' }).click();

    await page.getByRole('button', { name: 'Tutup periode Oktober' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Tutup periode Oktober 2026?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Tutup periode', exact: true })).toBeDisabled();
    await expect(dialog.getByText(/Belum bisa ditutup: petakan akun JU-26100417/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Batal' }).click();
    await expect(dialog).toBeHidden();

    await page.getByLabel('Akun lawan (kredit)').selectOption('1-1390');
    await expect(page.getByText(/siap diposting setelah disetujui penyetuju kedua/)).toBeVisible();
    await page.getByRole('button', { name: 'Padankan 2 mutasi' }).click();
    await expect(page.getByRole('region', { name: 'Rekonsiliasi bank' }).getByText('2 selisih')).toHaveCount(
      0,
    );

    await page.getByRole('button', { name: 'Tutup periode Oktober' }).click();
    await expect(dialog.getByRole('button', { name: 'Tutup periode', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Tutup periode', exact: true }).click();
    await expect(page.getByText(/Periode Oktober 2026 ditutup \d{2}\.\d{2}\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tutup periode Oktober' })).toHaveCount(0);
    await noHorizontalOverflow(page);
  });
});
