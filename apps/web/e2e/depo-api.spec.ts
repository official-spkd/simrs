import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { isoDateJakarta, newId } from '@simrs/shared';
import { DEMO_ACCOUNTS_FILE } from './demo-accounts-file';
import { inTenant, loginAs, TENANTS } from './support/accounts';
import { stockFixtures } from './support/stock';

/**
 * Potongan 4.6a · layar Depo mode api (S05, B01 minimal), data fiktif: apoteker FARMASI menerima barang ke gudang
 * (batch kedaluwarsa ditahan di layar dan API), mengirim mutasi FEFO ke depo IGD, menyesuaikan stok beralasan, dan
 * melihat kartu stok; apoteker IGD menerima mutasi. Saldo = Σ ledger diperiksa di DB.
 */

const day = (offset: number) => isoDateJakarta(new Date(Date.now() + offset * 86_400_000));

test.describe('Depo mode api (4.6a)', () => {
  test('penerimaan → mutasi FEFO dua langkah → penyesuaian beralasan → kartu stok', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'cukup di proyek desktop');
    test.setTimeout(120_000);
    const fx = stockFixtures(dirname(DEMO_ACCOUNTS_FILE));
    const batchNo = `PCT-E2E-${newId().slice(-6).toUpperCase()}`;
    const parasetamol = await inTenant(
      TENANTS.RSFA,
      async (tx) => (await tx.drug.findFirstOrThrow({ where: { name: 'Parasetamol 500 mg tablet' } })).id,
    );

    await loginAs(page, fx.accounts.farmasi, '/penunjang/depo');
    await expect(page.getByRole('heading', { name: 'Depo & stok farmasi', level: 1 })).toBeVisible();
    const depots = page.getByRole('navigation', { name: 'Pilih depo' });
    await expect(depots.getByRole('link', { name: 'Depo farmasi IGD' })).toHaveCount(0);
    await depots.getByRole('link', { name: 'Gudang farmasi' }).click();
    await expect(depots.getByRole('link', { name: 'Gudang farmasi' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('table', { name: 'Saldo per batch' })).toBeVisible();

    // 1. Penerimaan barang (ED lewat ditahan; lalu ED benar).
    await page.getByRole('tab', { name: 'Penerimaan barang' }).click();
    const receipt = page.getByRole('form', { name: 'Penerimaan barang' });
    await receipt.getByLabel('Nomor faktur').fill(`FKT-${batchNo}`);
    await receipt.getByLabel('Obat').fill('parasetamol');
    await receipt.getByRole('button', { name: /^Parasetamol 500 mg tablet/ }).click();
    await receipt.getByLabel('Nomor batch').fill(batchNo);
    await receipt.getByLabel('Tanggal kedaluwarsa').fill(day(-1));
    await receipt.getByLabel('Jumlah').fill('120');
    await receipt.getByLabel('Harga pokok per satuan (Rp)').fill('155');
    await expect(receipt.getByRole('alert')).toContainText('sudah kedaluwarsa dan tidak boleh diterima');
    await expect(receipt.getByRole('button', { name: 'Simpan penerimaan' })).toBeDisabled();
    await receipt.getByLabel('Tanggal kedaluwarsa').fill(day(30));
    await receipt.getByRole('button', { name: 'Simpan penerimaan' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: /TRM-\d{4}-\d{4} diterima di Gudang farmasi/ }),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Stok & kedaluwarsa' }).click();
    const row = page
      .getByRole('table', { name: 'Saldo per batch' })
      .getByRole('row')
      .filter({ hasText: batchNo });
    await expect(row).toContainText('120');
    await expect(row).toContainText('Segera kedaluwarsa');

    // 2. Mutasi FEFO ke depo IGD: batch layak dengan ED terdekat keluar lebih dulu.
    await page.getByRole('tab', { name: /^Mutasi antar depo/ }).click();
    const send = page.getByRole('form', { name: 'Kirim mutasi' });
    await send.getByLabel('Depo tujuan').selectOption({ label: 'Depo farmasi IGD' });
    await send.getByLabel('Obat').selectOption(parasetamol);
    await send.getByLabel('Jumlah').fill('15');
    // FEFO: batch layak dengan ED terdekat (paling lambat ED batch baru ini; run sebelumnya di DB yang sama bisa
    // meninggalkan batch ber-ED sama).
    const fefo = send.getByText(/^Batch FEFO: /);
    await expect(fefo).toBeVisible();
    const picked = /^Batch FEFO: (\S+) \(ED (\d{4}-\d{2}-\d{2})\)/.exec((await fefo.textContent()) ?? '');
    expect((picked?.[2] ?? '9999-12-31') <= day(30)).toBe(true);
    const pickedBatch = picked?.[1] ?? '';
    await send.getByRole('button', { name: 'Kirim mutasi' }).click();
    const sent = page.getByRole('status').filter({ hasText: /MUT-\d{4}-\d{4} dikirim ke Depo farmasi IGD/ });
    await expect(sent).toBeVisible();
    const transferNo = (await sent.textContent())?.match(/MUT-\d{4}-\d{4}/)?.[0] ?? '';

    // 3. Penyesuaian beralasan (rusak).
    await page.getByRole('tab', { name: 'Penyesuaian' }).click();
    const adjust = page.getByRole('form', { name: 'Penyesuaian stok' });
    const option = adjust.getByRole('option').filter({ hasText: batchNo });
    await adjust.getByLabel('Batch').selectOption((await option.getAttribute('value')) ?? '');
    await adjust.getByLabel(/^Selisih/).fill('-5');
    // Tanpa alasan ≥ 10 karakter tombol simpan nonaktif.
    await expect(adjust.getByRole('button', { name: 'Simpan penyesuaian' })).toBeDisabled();
    await adjust.getByLabel(/^Alasan/).fill('Strip rusak terkena air saat penyimpanan');
    await adjust.getByRole('button', { name: 'Simpan penyesuaian' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `Penyesuaian ${batchNo} (-5) tersimpan` }),
    ).toBeVisible();

    // 3b. Mutasi yang tersangkut dibatalkan pengirim beralasan (4.6a-2): stok kembali ke gudang.
    await page.getByRole('tab', { name: /^Mutasi antar depo/ }).click();
    await send.getByLabel('Depo tujuan').selectOption({ label: 'Depo kamar operasi' });
    await send.getByLabel('Obat').selectOption(parasetamol);
    await send.getByLabel('Jumlah').fill('2');
    await send.getByRole('button', { name: 'Kirim mutasi' }).click();
    const stuck = page
      .getByRole('status')
      .filter({ hasText: /MUT-\d{4}-\d{4} dikirim ke Depo kamar operasi/ });
    await expect(stuck).toBeVisible();
    const stuckNo = (await stuck.textContent())?.match(/MUT-\d{4}-\d{4}/)?.[0] ?? '';
    await page.getByRole('button', { name: `Batalkan ${stuckNo}` }).click();
    const cancelForm = page.getByRole('form', { name: `Batalkan ${stuckNo}` });
    await cancelForm.getByLabel(/^Alasan membatalkan/).fill('Jadwal operasi ditunda, obat kembali ke gudang');
    await cancelForm.getByRole('button', { name: 'Batalkan mutasi' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `${stuckNo} dibatalkan; stok kembali ke Gudang farmasi` }),
    ).toBeVisible();

    // 4. Kartu stok: penerimaan bernomor, mutasi keluar, penyesuaian dengan alasan.
    await page.getByRole('tab', { name: 'Kartu stok' }).click();
    const card = page.getByRole('table', { name: 'Kartu stok' });
    await expect(
      card.getByRole('row').filter({ hasText: 'Penerimaan' }).filter({ hasText: batchNo }),
    ).toContainText(/TRM-\d{4}-\d{4}/);
    await expect(
      card.getByRole('row').filter({ hasText: 'Mutasi keluar' }).filter({ hasText: transferNo }),
    ).toContainText(pickedBatch);
    await expect(
      card.getByRole('row').filter({ hasText: 'Penyesuaian' }).filter({ hasText: batchNo }),
    ).toContainText('Strip rusak terkena air');
    await page.screenshot({ path: testInfo.outputPath('depo-kartu-stok.png'), fullPage: true });

    // 5. Apoteker IGD menerima mutasi di depo tujuan.
    const igdContext = await browser.newContext();
    const igd = await igdContext.newPage();
    try {
      await loginAs(igd, fx.accounts.igd, '/penunjang/depo');
      await expect(igd.getByRole('navigation', { name: 'Pilih depo' }).getByRole('link')).toHaveText([
        'Depo farmasi IGD',
      ]);
      await igd.getByRole('tab', { name: /^Mutasi antar depo/ }).click();
      await igd.getByRole('button', { name: `Terima ${transferNo}` }).click();
      await expect(
        igd.getByRole('status').filter({ hasText: `${transferNo} diterima di Depo farmasi IGD` }),
      ).toBeVisible();
      await igd.getByRole('tab', { name: 'Stok & kedaluwarsa' }).click();
      await expect(
        igd.getByRole('table', { name: 'Saldo per batch' }).getByRole('row').filter({ hasText: pickedBatch }),
      ).toBeVisible();
    } finally {
      await igdContext.close();
    }

    const stored = await inTenant(TENANTS.RSFA, async (tx) => {
      const batch = await tx.stockBatch.findFirstOrThrow({ where: { batchNo }, select: { id: true } });
      const balances = await tx.stockBalance.findMany({
        where: { stockBatchId: batch.id },
        select: { quantity: true },
      });
      const ledger = await tx.stockMovement.aggregate({
        where: { stockBatchId: batch.id },
        _sum: { quantity: true },
      });
      return { total: balances.reduce((s, b) => s + b.quantity, 0), ledger: ledger._sum.quantity };
    });
    // 120 diterima − 5 disesuaikan = 115 di semua lokasi (mutasi tidak mengubah total); saldo = Σ ledger.
    expect(stored).toEqual({ total: 115, ledger: 115 });
  });
});
