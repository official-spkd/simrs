import { dirname } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { newId } from '@simrs/shared';
import { DEMO_ACCOUNTS_FILE } from './demo-accounts-file';
import { createPatient, inTenant, loginAs, TENANTS } from './support/accounts';
import { clinicalFixtures } from './support/clinical';

/**
 * Layar W2 · CPOE mode api (rencana fase 3 §W2, DoD "resep dengan alergi terdaftar diblokir; override butuh alasan dan
 * tercatat"), satu alur dengan data fiktif:
 * 1. DPJP membuka CPOE kunjungan pasien beralergi amoksisilin (fixture klinis), menambah sefadroksil → gerbang CDS
 *    server memblokir dan tombol kirim nonaktif; override beralasan → kirim (Idempotency-Key) → order aktif, override
 *    tercatat, resep dikirim untuk TTE; lalu batal beralasan.
 * 2. Residen IGD meresepkan amlodipin untuk pasien IGD → order aktif, menunggu tinjauan DPJP, tanpa resep. DPJP utama
 *    pasien itu melihatnya di daftar kunjungan CPOE, meninjau → atestasi `review_order`, resep ber-TTE atas nama DPJP
 *    (TTE sah lewat worker + mock TTE), tugas worklist tertutup.
 */

/** Kunjungan berjalan untuk pasien di unit tertentu (fixture langsung di DB tes). */
async function encounterFor(
  patientId: string,
  unitCode: 'MELATI' | 'IGD',
  team?: { dpjpUserId: string },
): Promise<string> {
  return inTenant(TENANTS.RSFA, async (tx) => {
    const unit = await tx.unit.findFirstOrThrow({ where: { code: unitCode } });
    const id = newId();
    await tx.encounter.create({
      data: {
        id,
        tenantId: TENANTS.RSFA,
        number: `${unitCode === 'IGD' ? 'IGD' : 'RI'}-E2E-${id.slice(-10)}`,
        patientId,
        encounterClass: unitCode === 'IGD' ? 'EMER' : 'IMP',
        status: 'in_progress',
        unitId: unit.id,
        // Aturan kelas kunjungan (`encounters_class_fields`): IGD wajib cara datang, rawat inap wajib rencana masuk.
        ...(unitCode === 'IGD' ? { arrivalMode: 'datang_sendiri' } : { plannedAt: new Date() }),
        startedAt: new Date(),
      },
    });
    if (team) {
      // Seperti CareTeamService: DPJP utama tim perawatan + relasi akses (ABAC `relationship`) bersumber keanggotaan.
      const participantId = newId();
      await tx.encounterParticipant.create({
        data: {
          id: participantId,
          tenantId: TENANTS.RSFA,
          encounterId: id,
          userId: team.dpjpUserId,
          role: 'dpjp_utama',
        },
      });
      await tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: TENANTS.RSFA,
          userId: team.dpjpUserId,
          patientId,
          kind: 'dpjp',
          sourceType: 'encounter_participant',
          sourceId: participantId,
        },
      });
    }
    return id;
  });
}

/** Tambah satu obat dari katalog dan lengkapi dosis + aturan pakai. */
async function addDrug(page: Page, search: string, name: string, dose: string) {
  await page.getByLabel('Cari pemeriksaan, obat, tindakan').fill(search);
  await page.getByRole('button', { name: `Tambah ${name}` }).click();
  await page.getByRole('textbox', { name: /^Dosis/ }).fill(dose);
  await page.getByRole('combobox', { name: /^Aturan pakai/ }).selectOption('1x1_pagi');
}

test.describe('CPOE mode api (W2)', () => {
  test('alergi: sefadroksil diblokir → override beralasan tercatat → batal beralasan; order residen → tinjauan DPJP → resep ber-TTE', async ({
    page,
    browser,
  }, testInfo) => {
    // Akun fixture klinis dipakai bersama; satu proyek cukup (kode TOTP tidak dipakai ulang lintas proyek), dan setiap
    // akun masuk sekali saja dalam tes ini.
    test.skip(testInfo.project.name !== 'desktop', 'cukup di proyek desktop');
    test.setTimeout(150_000);
    const fx = clinicalFixtures(dirname(DEMO_ACCOUNTS_FILE));
    const encounterId = await encounterFor(fx.allergicPatient.id, 'MELATI');
    await loginAs(page, fx.accounts.dpjp, `/klinis/order/${encounterId}`);

    // --- 1. CDS memblokir resep untuk pasien beralergi; override beralasan; batal beralasan ---
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

    // --- 2. Order residen → tinjauan DPJP utama → resep ber-TTE DPJP ---
    const suffix = newId().slice(-6);
    const patientName = `Tn. Order Residen ${suffix} Fiktif`;
    const igdPatient = await createPatient('RSFA', {
      name: patientName,
      sex: 'male',
      birthDate: '1971-08-17',
    });
    const igdEncounter = await encounterFor(igdPatient.id, 'IGD', { dpjpUserId: fx.accounts.dpjp.id });

    const residentContext = await browser.newContext();
    const resident = await residentContext.newPage();
    try {
      await loginAs(resident, fx.accounts.residen, `/klinis/order/${igdEncounter}`);
      await expect(resident.getByLabel('Identitas pasien')).toContainText(patientName);
      await addDrug(resident, 'amlodipin', 'Amlodipin 5 mg tablet', '5 mg');
      const residentSend = resident.getByRole('button', { name: 'Kirim 1 order' });
      await expect(residentSend).toBeEnabled();
      await residentSend.click();
      await expect(resident.getByRole('status').filter({ hasText: '1 order terkirim' })).toContainText(
        'menunggu tinjauan DPJP',
      );
      const residentOrders = resident.getByRole('region', { name: 'Order kunjungan ini' });
      await expect(residentOrders.getByText('Menunggu tinjauan DPJP')).toBeVisible();
      // Residen tidak bertanda tangan resep: belum ada resep, dan tidak ada tombol tinjau.
      await expect(residentOrders.getByText(/Resep · TTE/)).toHaveCount(0);
      await expect(residentOrders.getByRole('button', { name: /Tinjau/ })).toHaveCount(0);
    } finally {
      await residentContext.close();
    }
    const group = await inTenant(TENANTS.RSFA, (tx) =>
      tx.orderGroup.findFirstOrThrow({
        where: { encounterId: igdEncounter },
        select: { id: true, needsReview: true },
      }),
    );
    expect(group.needsReview).toBe(true);

    // DPJP: daftar kunjungan CPOE menandai order residen yang menunggu tinjauan.
    await page.goto('/klinis/order');
    const list = page.getByRole('region', { name: 'Kunjungan berjalan' });
    const row = list.getByRole('link').filter({ hasText: patientName });
    await expect(row).toContainText('1 order residen menunggu tinjauan');
    await row.click();
    await expect(page.getByLabel('Identitas pasien')).toContainText(patientName);
    const dpjpOrders = page.getByRole('region', { name: 'Order kunjungan ini' });
    await expect(dpjpOrders.getByText('Amlodipin 5 mg tablet')).toBeVisible();
    await dpjpOrders.getByRole('button', { name: 'Tinjau dan tandatangani resep' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Order residen ditinjau' })).toContainText(
      'resep dikirim untuk TTE',
    );
    await expect(dpjpOrders.getByText(/^Ditinjau dr\. DPJP E2E Fiktif/)).toBeVisible();
    await expect(dpjpOrders.getByText('Menunggu tinjauan DPJP')).toHaveCount(0);
    // Worker mengirim `tte.sign` ke mock TTE; layar memuat ulang sendiri selama TTE diproses.
    await expect(dpjpOrders.getByText('Resep · TTE sah')).toBeVisible({ timeout: 45_000 });
    await page.screenshot({ path: testInfo.outputPath('cpoe-tinjauan-dpjp.png'), fullPage: true });

    const stored = await inTenant(TENANTS.RSFA, async (tx) => ({
      attestation: await tx.clinicalAttestation.findFirst({
        where: { targetType: 'order_groups', targetId: group.id, kind: 'review_order' },
        select: { userId: true },
      }),
      signature: await tx.documentSignature.findFirst({
        where: { document: { sourceType: 'order_groups', sourceId: group.id } },
        select: { signerUserId: true, status: true },
      }),
    }));
    expect(stored).toEqual({
      attestation: { userId: fx.accounts.dpjp.id },
      signature: { signerUserId: fx.accounts.dpjp.id, status: 'signed' },
    });

    // Tugas worklist "Tinjau order residen" tertutup: tanda di daftar kunjungan hilang.
    await page.goto('/klinis/order');
    await expect(
      page
        .getByRole('region', { name: 'Kunjungan berjalan' })
        .getByRole('link')
        .filter({ hasText: patientName }),
    ).not.toContainText('menunggu tinjauan');
  });
});
