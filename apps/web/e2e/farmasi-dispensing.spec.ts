import { expect, test } from '@playwright/test';
import { newId } from '@simrs/shared';
import { createPatient, inTenant, loginAs, TENANTS } from './support/accounts';
import { account } from './support/clinical';

/**
 * Potongan 4.6b · layar Farmasi mode api (S05 dispensing), data fiktif: order enoksaparin (kewaspadaan tinggi) dari
 * CPOE (fixture DB), apoteker A menerima + menelaah, menyiapkan FEFO (ledger `dispense`, label `OBT-…`), tidak boleh
 * cek ganda sendiri, serah ditolak tanpa cek ganda; apoteker B (sesi sendiri) cek ganda, menyerahkan ke perawat, lalu
 * mencatat retur layak. Saldo = Σ ledger dan tagihan obat saat serah diperiksa di DB.
 */

test.describe('Farmasi dispensing mode api (4.6b)', () => {
  test('telaah → siapkan FEFO → cek ganda apoteker lain → serah → retur', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'cukup di proyek desktop');
    test.setTimeout(150_000);
    const number = `RI-E2E-DSP-${newId().slice(-8)}`;
    const patient = await createPatient('RSFA', { name: 'Tn. Dispensing Fiktif' });
    const fx = await inTenant(TENANTS.RSFA, async (tx) => {
      const penyiap = await account(tx, TENANTS.RSFA, 'apoteker', 'FARMASI', 'apt. Penyiap E2E Fiktif');
      const pemeriksa = await account(tx, TENANTS.RSFA, 'apoteker', 'FARMASI', 'apt. Pemeriksa E2E Fiktif');
      const dokter = await account(tx, TENANTS.RSFA, 'dokter', 'MELATI', 'dr. Penulis E2E Fiktif');
      const unit = await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } });
      const encounterId = newId();
      await tx.encounter.create({
        data: {
          id: encounterId,
          tenantId: TENANTS.RSFA,
          number,
          patientId: patient.id,
          encounterClass: 'IMP',
          status: 'in_progress',
          unitId: unit.id,
          plannedAt: new Date(),
          startedAt: new Date(),
        },
      });
      // Kiriman CPOE (bentuk sama dengan `POST /orders/submit`) tanpa login dokter.
      const groupId = newId();
      await tx.orderGroup.create({
        data: {
          id: groupId,
          tenantId: TENANTS.RSFA,
          encounterId,
          patientId: patient.id,
          idempotencyKey: newId(),
          requestHash: 'e'.repeat(64),
          orderedBy: dokter.id,
          orderedRole: 'dokter',
        },
      });
      const drug = await tx.drug.findFirstOrThrow({ where: { name: 'Enoksaparin 60 mg/0,6 mL injeksi' } });
      const medId = newId();
      await tx.medicationRequest.create({
        data: {
          id: medId,
          tenantId: TENANTS.RSFA,
          orderGroupId: groupId,
          encounterId,
          patientId: patient.id,
          drugId: drug.id,
          name: drug.name,
          dose: '60 mg',
          route: 'subkutan',
          frequency: '1x1_pagi',
          durationDays: 3,
          highAlert: true,
        },
      });
      await tx.orderStatusEvent.create({
        data: {
          id: newId(),
          tenantId: TENANTS.RSFA,
          medicationRequestId: medId,
          status: 'aktif',
          changedBy: dokter.id,
        },
      });
      // Isi ulang depo RI agar run berulang di DB yang sama tidak kehabisan stok (penyesuaian beralasan).
      const depot = await tx.stockLocation.findFirstOrThrow({ where: { code: 'DEPO-RI' } });
      const batch = await tx.stockBatch.findFirstOrThrow({ where: { batchNo: 'ENX-01' } });
      const adjustmentId = newId();
      await tx.stockAdjustment.create({
        data: {
          id: adjustmentId,
          tenantId: TENANTS.RSFA,
          stockLocationId: depot.id,
          reason: 'Isi ulang stok uji E2E dispensing',
          adjustedBy: penyiap.id,
        },
      });
      await tx.stockMovement.create({
        data: {
          id: newId(),
          tenantId: TENANTS.RSFA,
          stockLocationId: depot.id,
          stockBatchId: batch.id,
          kind: 'adjustment',
          quantity: 2,
          refType: 'stock_adjustments',
          refId: adjustmentId,
          reason: 'Isi ulang stok uji E2E dispensing',
          createdBy: penyiap.id,
        },
      });
      return { penyiap, pemeriksa, encounterId, batchId: batch.id, depotId: depot.id };
    });

    // 1. Apoteker penyiap: terima, telaah, siapkan FEFO.
    await loginAs(page, fx.penyiap, '/penunjang/farmasi');
    const incoming = page
      .getByRole('list', { name: 'Kiriman resep masuk' })
      .getByRole('listitem')
      .filter({ hasText: number });
    await incoming.getByRole('button', { name: /^Terima resep/ }).click();
    await expect(page).toHaveURL(/\?resep=/);
    const resep = new URL(page.url()).searchParams.get('resep') ?? '';
    const detail = page.getByRole('region', { name: /^Resep R-\d{4}-\d{4}$/ });
    await expect(detail.getByRole('list', { name: 'Temuan CDS' })).toContainText('Obat kewaspadaan tinggi');
    const review = detail.getByRole('form', { name: 'Telaah resep' });
    for (const aspect of ['administratif', 'farmasetik', 'klinis']) {
      await review.getByLabel(`Aspek ${aspect} sesuai`).check();
    }
    await review.getByRole('button', { name: 'Simpan telaah' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'lolos telaah' })).toBeVisible();

    const prepare = detail.getByRole('form', { name: 'Penyiapan obat' });
    await prepare.getByLabel('Jumlah Enoksaparin 60 mg/0,6 mL injeksi').fill('2');
    await prepare.getByRole('button', { name: 'Siapkan obat' }).click();
    await expect(page.getByRole('status').filter({ hasText: /disiapkan: Enoksaparin .* × 2/ })).toBeVisible();
    const card = detail.getByRole('region', { name: /^Penyiapan R-/ });
    await expect(card.getByRole('table', { name: 'Item disiapkan' })).toContainText(/OBT-[0-9A-F]{12}/);
    await expect(card).toContainText('Wajib cek ganda apoteker kedua');

    // Penyiap tidak boleh cek ganda sendiri; serah tanpa cek ganda ditolak server.
    await card.getByRole('button', { name: 'Konfirmasi cek ganda' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'apoteker lain' })).toBeVisible();
    const handover = card.getByRole('form', { name: 'Serah terima obat' });
    await handover.getByRole('combobox', { name: /^Penerima/ }).selectOption('perawat');
    await handover.getByLabel('Nama penerima').fill('Ns. Penerima Fiktif');
    await handover.getByLabel('PIO (informasi obat) sudah diberikan').check();
    await handover.getByRole('button', { name: 'Serahkan obat' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'wajib cek ganda apoteker kedua' }),
    ).toBeVisible();

    // 2. Apoteker kedua dari sesinya sendiri: cek ganda → serah → retur layak.
    const ctx = await browser.newContext();
    const second = await ctx.newPage();
    try {
      await loginAs(second, fx.pemeriksa, `/penunjang/farmasi?resep=${resep}`);
      const card2 = second.getByRole('region', { name: /^Penyiapan R-/ });
      await card2.getByRole('button', { name: 'Konfirmasi cek ganda' }).click();
      await expect(second.getByRole('status').filter({ hasText: 'Cek ganda tercatat' })).toBeVisible();
      await expect(card2).toContainText('Cek ganda apt. Pemeriksa E2E Fiktif');
      const handover2 = card2.getByRole('form', { name: 'Serah terima obat' });
      await handover2.getByRole('combobox', { name: /^Penerima/ }).selectOption('perawat');
      await handover2.getByLabel('Nama penerima').fill('Ns. Penerima Fiktif');
      await handover2.getByLabel('PIO (informasi obat) sudah diberikan').check();
      await handover2.getByRole('button', { name: 'Serahkan obat' }).click();
      await expect(
        second.getByRole('status').filter({ hasText: 'diserahkan ke Ns. Penerima Fiktif' }),
      ).toBeVisible();
      await expect(card2.getByText('Diserahkan', { exact: true })).toBeVisible();

      const ret = card2.getByRole('form', { name: 'Retur obat' });
      await ret.getByLabel('Jumlah retur').fill('1');
      await ret.getByLabel(/^Alasan retur/).fill('Dosis kedua dihentikan dokter');
      await ret.getByRole('button', { name: 'Simpan retur' }).click();
      await expect(
        second.getByRole('status').filter({ hasText: 'stok kembali ke Depo farmasi rawat inap' }),
      ).toBeVisible();
      await second.screenshot({ path: testInfo.outputPath('farmasi-dispensing.png'), fullPage: true });
    } finally {
      await ctx.close();
    }

    const stored = await inTenant(TENANTS.RSFA, async (tx) => {
      const rx = await tx.pharmacyPrescription.findFirstOrThrow({
        where: { encounterId: fx.encounterId },
        select: { status: true },
      });
      const items = await tx.dispenseItem.findMany({
        where: { dispense: { encounterId: fx.encounterId } },
        select: { quantity: true, labelBarcode: true },
      });
      const ledger = await tx.stockMovement.aggregate({
        where: { stockBatchId: fx.batchId, stockLocationId: fx.depotId },
        _sum: { quantity: true },
      });
      const balance = await tx.stockBalance.findFirst({
        where: { stockBatchId: fx.batchId, stockLocationId: fx.depotId },
        select: { quantity: true },
      });
      return {
        status: rx.status,
        items: items.map((i) => i.quantity),
        billable: await tx.billableEvent.count({
          where: { encounterId: fx.encounterId, kind: 'obat', sourceType: 'dispense_items' },
        }),
        returns: await tx.dispenseReturn.count({
          where: { dispenseItem: { dispense: { encounterId: fx.encounterId } } },
        }),
        consistent: ledger._sum.quantity === balance?.quantity,
      };
    });
    expect(stored).toEqual({ status: 'selesai', items: [2], billable: 1, returns: 1, consistent: true });
  });
});
