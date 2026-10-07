import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { newId } from '@simrs/shared';
import { type Account, inTenant, loginAs, TENANTS } from './support/accounts';
import { admitPatient, createStaff, createWard } from './support/inpatient';

/**
 * Bagan RME mode api (layar FE2 yang kini hibrida): Worklist (K01), Diagnosis (K08), Ringkasan (K14), Kelengkapan +
 * tutup kunjungan (K13), Asesmen P07 + kelengkapan paket (K06/K15), Asuhan keperawatan (K12), dan CPPT (K07). Tiap tes
 * punya bangsal fiktif sendiri; pasien diadmisi lewat API sungguhan. Tanpa galat konsol. Data fiktif.
 */

const contexts: BrowserContext[] = [];
const consoleErrors: string[] = [];

async function as(browser: Browser, acc: Account, path: string): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) {
      consoleErrors.push(`${acc.displayName}: ${m.text()} @ ${m.location().url}`);
    }
  });
  page.on('pageerror', (e) => consoleErrors.push(`${acc.displayName}: ${e.message}`));
  await loginAs(page, acc, path);
  await page.goto(path);
  return page;
}

test.afterEach(async () => {
  const errors = consoleErrors.splice(0);
  for (const ctx of contexts.splice(0)) await ctx.close();
  expect(errors).toEqual([]);
});

/** Perawat penanggung jawab pasien (relasi akses; isian formulir P07 berlingkup relasi). */
async function addNurseRelation(patientId: string, encounterId: string, nurseId: string) {
  await inTenant(TENANTS.RSFA, async (tx) => {
    const pid = newId();
    await tx.encounterParticipant.create({
      data: { id: pid, tenantId: TENANTS.RSFA, encounterId, userId: nurseId, role: 'perawat_pj' },
    });
    await tx.accessRelationship.create({
      data: {
        id: newId(),
        tenantId: TENANTS.RSFA,
        userId: nurseId,
        patientId,
        kind: 'perawat_penanggung_jawab',
        sourceType: 'encounter_participant',
        sourceId: pid,
      },
    });
  });
}

test.describe('Bagan RME mode api', () => {
  test('DPJP: worklist → diagnosis ICD-10 + tindakan + NKDA → ringkasan → kelengkapan menolak tutup tanpa resume', async ({
    browser,
  }) => {
    const ward = await createWard();
    const tag = ward.unitName.split(' ').at(-1);
    const dpjp = await createStaff('dokter', ward.unitId, `dr. DPJP Rekam ${tag}, Sp.PD`);
    const p = await admitPatient(ward, dpjp, `Tn. Rekam Api ${tag}`);

    const page = await as(browser, dpjp, '/klinis/worklist?view=dpjp');
    await expect(page.getByRole('heading', { name: 'Worklist klinis', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Pasien' })).toContainText(p.patientName);

    await page.goto(`/klinis/diagnosis?kunjungan=${p.encounterId}`);
    await expect(page.getByLabel('Identitas pasien')).toContainText(p.mrn);
    const dx = page.getByRole('form', { name: 'Tambah diagnosis' });
    await dx.getByLabel('Cari kode atau nama (minimal 2 huruf)').fill('pneumonia');
    await dx.getByRole('button', { name: /J18\.9 Pneumonia, tidak spesifik/ }).click();
    await expect(dx.getByLabel('Peran diagnosis')).toHaveValue('utama');
    await dx.getByRole('button', { name: 'Tambah diagnosis' }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'J18.9 Pneumonia, tidak spesifik tercatat sebagai diagnosis utama' }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Diagnosis kunjungan' })).toContainText('Utama');
    const proc = page.getByRole('form', { name: 'Tambah tindakan' });
    await proc.getByLabel('Cari kode atau nama (minimal 2 huruf)').fill('kateter');
    await proc.getByRole('button', { name: /38\.93 Pemasangan kateter vena sentral/ }).click();
    await proc.getByRole('button', { name: 'Tambah tindakan' }).click();
    await expect(page.getByRole('region', { name: 'Tindakan' })).toContainText('38.93');
    await page.getByRole('button', { name: 'Catat tidak ada alergi obat (NKDA)' }).click();
    await expect(page.getByRole('region', { name: 'Alergi' })).toContainText(
      'Tidak ada alergi obat yang diketahui (NKDA)',
    );

    await page.goto(`/klinis/ringkasan?kunjungan=${p.encounterId}`);
    await expect(page.getByRole('heading', { name: 'Ringkasan pasien', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Alergi' })).toContainText('NKDA');
    await expect(page.getByRole('region', { name: 'Tindakan terbaru' })).toContainText('38.93');
    await expect(page.getByRole('region', { name: 'Riwayat kunjungan' })).toContainText('J18.9');

    await page.goto(`/klinis/kelengkapan?kunjungan=${p.encounterId}`);
    const checks = page.getByRole('region', { name: 'Kelengkapan rekam medis' });
    await expect(
      checks.getByRole('listitem').filter({ hasText: 'Resume medis final ber-TTE' }),
    ).toContainText('Belum lengkap');
    const close = page.getByRole('region', { name: 'Tutup kunjungan' });
    await close.getByLabel('Disposisi').selectOption({ label: 'Pulang atas persetujuan dokter' });
    await close.getByRole('button', { name: 'Tutup kunjungan' }).click();
    await expect(close.getByRole('alert')).toContainText('Syarat pulang belum lengkap');
    const still = await inTenant(TENANTS.RSFA, (tx) =>
      tx.encounter.findUniqueOrThrow({ where: { id: p.encounterId }, select: { status: true } }),
    );
    expect(still.status).toBe('in_progress');
  });

  test('perawat PJ: asesmen Morse lewat P07 melengkapi paket rawat inap; askep dan CPPT terbuka untuk kunjungan', async ({
    browser,
  }) => {
    const ward = await createWard();
    const tag = ward.unitName.split(' ').at(-1);
    const dpjp = await createStaff('dokter', ward.unitId, `dr. DPJP Asesmen ${tag}, Sp.PD`);
    const nurse = await createStaff('perawat', ward.unitId, `Ns. Asesmen ${tag}`);
    const p = await admitPatient(ward, dpjp, `Ny. Asesmen Api ${tag}`);
    await addNurseRelation(p.patientId, p.encounterId, nurse.id);

    const page = await as(browser, nurse, '/klinis/asesmen');
    await page
      .getByRole('region', { name: 'Kunjungan berjalan' })
      .getByRole('link', { name: new RegExp(p.patientName) })
      .click();
    const pkg = page.getByRole('region', { name: 'Kelengkapan formulir' });
    await expect(pkg).toContainText('Belum lengkap');
    await page
      .getByRole('navigation', { name: 'Formulir asesmen' })
      .getByRole('link', { name: 'Asesmen risiko jatuh dewasa (Morse)' })
      .click();
    const form = page.getByRole('form', { name: 'Isi Asesmen risiko jatuh dewasa (Morse)' });
    const pick = (group: string, option: string) =>
      form
        .getByRole('group', { name: group })
        .getByRole('radio', { name: new RegExp(`^${option}`) })
        .check();
    await pick('Riwayat jatuh dalam 3 bulan', 'Ya');
    await pick('Diagnosis sekunder (lebih dari satu)', 'Tidak');
    await pick('Alat bantu berjalan', 'Kruk');
    await pick('Terpasang infus atau heparin lock', 'Ya');
    await pick('Cara berjalan', 'Lemah');
    await pick('Status mental', 'Sadar');
    await form.getByRole('button', { name: 'Simpan asesmen (final)' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Asesmen tersimpan final' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Asesmen kunjungan ini' })).toContainText(
      'Asesmen risiko jatuh dewasa (Morse)',
    );
    await expect(pkg).toContainText('Lengkap · wajib 1/1');

    await page.goto(`/klinis/asuhan-keperawatan?kunjungan=${p.encounterId}`);
    await expect(page.getByRole('heading', { name: 'Asuhan keperawatan', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Rencana asuhan keperawatan' })).toBeVisible();
    await page.goto(`/klinis/cppt?kunjungan=${p.encounterId}`);
    await expect(page.getByRole('heading', { name: 'CPPT & serah terima', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Identitas pasien')).toContainText(p.mrn);
  });
});
