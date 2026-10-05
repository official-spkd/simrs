import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { newId } from '@simrs/shared';
import { DEMO_ACCOUNTS_FILE } from './demo-accounts-file';
import { inTenant, loginAs, TENANTS } from './support/accounts';
import { clinicalFixtures } from './support/clinical';

/**
 * Layar W2 · CPOE mode api (rencana fase 3 §W2, DoD "resep dengan alergi terdaftar diblokir; override butuh alasan dan
 * tercatat"): DPJP membuka CPOE kunjungan pasien beralergi amoksisilin (fixture klinis), menambah sefadroksil →
 * gerbang CDS server memblokir dan tombol kirim nonaktif; override beralasan → kirim (Idempotency-Key) → order aktif,
 * override tercatat, resep dikirim untuk TTE; lalu batal beralasan. Data fiktif.
 */

/** Kunjungan rawat inap aktif di Melati (unit penugasan DPJP fixture) untuk pasien beralergi. */
async function encounterFor(patientId: string): Promise<string> {
  return inTenant(TENANTS.RSFA, async (tx) => {
    const unit = await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } });
    const id = newId();
    await tx.encounter.create({
      data: {
        id,
        tenantId: TENANTS.RSFA,
        number: `RI-E2E-${id.slice(-10)}`,
        patientId,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: unit.id,
        plannedAt: new Date(),
      },
    });
    return id;
  });
}

test.describe('CPOE mode api (W2)', () => {
  test('resep sefadroksil untuk pasien alergi amoksisilin diblokir; override beralasan terkirim dan tercatat; batal beralasan', async ({
    page,
  }, testInfo) => {
    // Satu akun DPJP fixture dipakai bersama; satu proyek cukup (kode TOTP tidak dipakai ulang lintas proyek).
    test.skip(testInfo.project.name !== 'desktop', 'cukup di proyek desktop');
    const fx = clinicalFixtures(dirname(DEMO_ACCOUNTS_FILE));
    const encounterId = await encounterFor(fx.allergicPatient.id);
    await loginAs(page, fx.accounts.dpjp, `/klinis/order/${encounterId}`);

    await expect(page.getByRole('heading', { name: 'Order & resep (CPOE)', level: 1 })).toBeVisible();
    const banner = page.getByLabel('Identitas pasien');
    await expect(banner).toContainText('Ny. Alergi Amoksisilin Fiktif');
    await expect(banner).toContainText(/Alergi: .*Amoksisilin/i);

    await page.getByLabel('Cari pemeriksaan, obat, tindakan').fill('sefadroksil');
    await page.getByRole('button', { name: 'Tambah Sefadroksil 500 mg kapsul' }).click();

    // Gerbang CDS server: blok reaksi silang penisilin → sefalosporin generasi 1.
    const gate = page.getByRole('alert').filter({ hasText: 'CDS memblokir Sefadroksil 500 mg kapsul' });
    await expect(gate).toBeVisible();
    await page.getByRole('textbox', { name: /^Dosis/ }).fill('500 mg');
    await page.getByRole('combobox', { name: /^Aturan pakai/ }).selectOption('3x1');
    const send = page.getByRole('button', { name: 'Kirim 1 order' });
    await expect(send).toBeDisabled();
    await expect(page.getByText(/1 order diblokir CDS \(Sefadroksil 500 mg kapsul\)/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('cpoe-diblokir.png'), fullPage: true });

    const reason = 'Riwayat sefadroksil tahun lalu tanpa reaksi; alternatif tidak tersedia';
    await gate.getByRole('button', { name: 'Override dengan alasan' }).click();
    await gate.getByLabel(/Alasan klinis/).fill(reason);
    await gate.getByRole('button', { name: 'Simpan alasan dan lanjut' }).click();
    await expect(page.getByText('Pemeriksaan CDS selesai. Order siap dikirim')).toBeVisible();
    await expect(send).toBeEnabled();
    await send.click();

    const done = page.getByRole('status').filter({ hasText: '1 order terkirim' });
    await expect(done).toContainText('resep dikirim untuk TTE');
    const orders = page.getByRole('region', { name: 'Order kunjungan ini' });
    await expect(orders.getByText('Sefadroksil 500 mg kapsul')).toBeVisible();
    await expect(orders.getByText(`Alasan: ${reason}`)).toBeVisible();
    await expect(orders.getByText(/Resep · TTE (diproses|sah)/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('cpoe-terkirim.png'), fullPage: true });

    const alerts = await inTenant(TENANTS.RSFA, (tx) =>
      tx.cdsAlert.findMany({
        where: { encounterId },
        select: { decision: true, overrideReason: true, level: true },
      }),
    );
    expect(alerts).toEqual([{ decision: 'override', overrideReason: reason, level: 'block' }]);

    // Batal beralasan: status `dibatalkan` dengan alasannya.
    await orders.getByRole('button', { name: 'Batalkan', exact: true }).click();
    await orders.getByLabel(/Alasan membatalkan Sefadroksil/).fill('Pasien menolak minum obat kapsul');
    await orders.getByRole('button', { name: 'Batalkan order' }).click();
    await expect(orders.getByText('Dibatalkan', { exact: true })).toBeVisible();
    await expect(orders.getByText('Alasan batal: Pasien menolak minum obat kapsul')).toBeVisible();
  });
});
