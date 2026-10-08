import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { newId } from '@simrs/shared';
import { DEMO_ACCOUNTS_FILE } from './demo-accounts-file';
import { inTenant, loginAs, TENANTS } from './support/accounts';
import { account, clinicalFixtures } from './support/clinical';
import { stockFixtures } from './support/stock';

/**
 * Potongan 4.5 · layar Farmasi mode api (S04), data fiktif: DPJP meresepkan sefadroksil untuk pasien beralergi
 * amoksisilin dengan override beralasan di CPOE; apoteker FARMASI menerima kiriman ke depo rawat inap, melihat temuan
 * alergi yang wajib ditinjau (setujui ditolak `CDS_UNRESOLVED`), kolom stok depo dari API stok, mengirim intervensi ke
 * dokter penulis (resep tidak berubah), mengonfirmasi temuan, lalu menyetujui telaah → penyiapan.
 */

test.describe('Farmasi mode api (4.5)', () => {
  test('kiriman CPOE → terima resep → CDS wajib ditinjau → intervensi → konfirmasi → setujui', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'cukup di proyek desktop');
    test.setTimeout(150_000);
    const dir = dirname(DEMO_ACCOUNTS_FILE);
    const clinical = clinicalFixtures(dir);
    const stock = stockFixtures(dir);
    const number = `RI-E2E-RX-${newId().slice(-8)}`;
    const { dokter, encounterId } = await inTenant(TENANTS.RSFA, async (tx) => {
      const dokter = await account(tx, TENANTS.RSFA, 'dokter', 'MELATI', 'dr. Penulis Resep E2E Fiktif');
      const unit = await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } });
      const id = newId();
      await tx.encounter.create({
        data: {
          id,
          tenantId: TENANTS.RSFA,
          number,
          patientId: clinical.allergicPatient.id,
          encounterClass: 'IMP',
          status: 'in_progress',
          unitId: unit.id,
          plannedAt: new Date(),
          startedAt: new Date(),
        },
      });
      return { dokter, encounterId: id };
    });

    // 1. DPJP: sefadroksil diblokir CDS → override beralasan → kirim.
    await loginAs(page, dokter, `/klinis/order/${encounterId}`);
    await page.getByLabel('Cari pemeriksaan, obat, tindakan').fill('sefadroksil');
    await page.getByRole('button', { name: 'Tambah Sefadroksil 500 mg kapsul' }).click();
    const gate = page.getByRole('alert').filter({ hasText: 'CDS memblokir Sefadroksil 500 mg kapsul' });
    await expect(gate).toBeVisible();
    await page.getByRole('textbox', { name: /^Dosis/ }).fill('500 mg');
    await page.getByRole('combobox', { name: /^Aturan pakai/ }).selectOption('3x1');
    const reason = 'Riwayat sefadroksil tahun lalu tanpa reaksi; alternatif tidak tersedia';
    await gate.getByRole('button', { name: 'Override dengan alasan' }).click();
    await gate.getByLabel(/Alasan klinis/).fill(reason);
    await gate.getByRole('button', { name: 'Simpan alasan dan lanjut' }).click();
    await page.getByRole('button', { name: 'Kirim 1 order' }).click();
    await expect(page.getByRole('status').filter({ hasText: '1 order terkirim' })).toBeVisible();

    // 2. Apoteker FARMASI menerima kiriman ke depo rawat inap.
    const ctx = await browser.newContext();
    const apt = await ctx.newPage();
    try {
      await loginAs(apt, stock.accounts.telaah, '/penunjang/farmasi');
      await expect(apt.getByRole('heading', { name: 'Farmasi', level: 1 })).toBeVisible();
      const incoming = apt
        .getByRole('list', { name: 'Kiriman resep masuk' })
        .getByRole('listitem')
        .filter({ hasText: number });
      await expect(incoming).toContainText('Sefadroksil 500 mg kapsul');
      await expect(incoming).toContainText('Depo farmasi rawat inap');
      await incoming.getByRole('button', { name: /^Terima resep/ }).click();
      await expect(apt).toHaveURL(/\?resep=/);
      const detail = apt.getByRole('region', { name: /^Resep R-\d{4}-\d{4}$/ });
      await expect(detail.getByRole('heading', { level: 2 })).toContainText('Ny. Alergi Amoksisilin Fiktif');
      await expect(detail).toContainText(/Alergi: .*amoksisilin/i);

      // Kolom stok depo dari API stok: sefadroksil belum pernah diterima di depo RI → habis.
      const item = detail.getByRole('table', { name: 'Item resep' }).getByRole('row').filter({
        hasText: 'Sefadroksil 500 mg kapsul',
      });
      await expect(item).toContainText('Habis');

      // 3. Override dokter atas alergi wajib ditinjau apoteker: setujui ditolak server.
      const alert = detail
        .getByRole('list', { name: 'Temuan CDS' })
        .getByRole('listitem')
        .filter({ hasText: 'Alergi · Sefadroksil 500 mg kapsul' });
      await expect(alert).toContainText('wajib ditinjau');
      await expect(alert).toContainText(reason);
      const review = detail.getByRole('form', { name: 'Telaah resep' });
      for (const aspect of ['administratif', 'farmasetik', 'klinis']) {
        await review.getByLabel(`Aspek ${aspect} sesuai`).check();
      }
      await review.getByRole('button', { name: 'Simpan telaah' }).click();
      // Peringatan non-kritis tampil sebagai `status` (komponen Alert level warning).
      await expect(apt.getByRole('status').filter({ hasText: 'belum ditindaklanjuti' })).toBeVisible();

      // 4. Intervensi ke dokter penulis: resep tidak berubah.
      const intervene = detail.getByRole('form', { name: 'Intervensi apoteker' });
      await intervene.getByLabel('Jenis usulan').selectOption('ganti_obat');
      await intervene.getByLabel('Sefadroksil 500 mg kapsul').check();
      await intervene.getByLabel(/^Usulan/).fill('Pertimbangkan klindamisin karena riwayat alergi penisilin');
      await intervene.getByRole('button', { name: 'Kirim usulan' }).click();
      await expect(apt.getByRole('status').filter({ hasText: 'Usulan terkirim' })).toBeVisible();
      await expect(detail.getByRole('list', { name: 'Daftar intervensi' })).toContainText(
        'Menunggu jawaban dr. Penulis Resep E2E Fiktif',
      );

      // 5. Konfirmasi temuan → setujui → penyiapan.
      await alert.getByRole('button', { name: 'Konfirmasi aman' }).click();
      await expect(alert).toContainText('Teratasi');
      for (const aspect of ['administratif', 'farmasetik', 'klinis']) {
        await review.getByLabel(`Aspek ${aspect} sesuai`).check();
      }
      await review.getByRole('button', { name: 'Simpan telaah' }).click();
      await expect(apt.getByRole('status').filter({ hasText: 'lolos telaah' })).toBeVisible();
      await expect(detail.getByText('Penyiapan', { exact: true })).toBeVisible();
      await apt.screenshot({ path: testInfo.outputPath('farmasi-telaah.png'), fullPage: true });
    } finally {
      await ctx.close();
    }

    const stored = await inTenant(TENANTS.RSFA, async (tx) => {
      const rx = await tx.pharmacyPrescription.findFirstOrThrow({
        where: { encounterId },
        select: { id: true, status: true },
      });
      return {
        status: rx.status,
        reviews: await tx.prescriptionReview.count({ where: { pharmacyPrescriptionId: rx.id } }),
        interventions: await tx.pharmacistIntervention.count({ where: { pharmacyPrescriptionId: rx.id } }),
        medications: await tx.medicationRequest.findMany({
          where: { encounterId },
          select: { dose: true, frequency: true },
        }),
      };
    });
    expect(stored).toEqual({
      status: 'penyiapan',
      reviews: 1,
      interventions: 1,
      medications: [{ dose: '500 mg', frequency: '3x1' }],
    });
  });
});
