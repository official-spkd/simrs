import { expect, test } from '@playwright/test';
import { newId } from '@simrs/shared';
import { type Account, createAccount, createPatient, inTenant, TENANTS, loginAs } from './support/accounts';

/**
 * K13 · Layar Resume medis mode api (W5b): himpun draf dari sumber (isi = data sumber dengan label sumber), isian DPJP,
 * rekonsiliasi obat pulang dikonfirmasi DPJP, 12 butir server, TTE → terkunci, addendum. Sumber klinis fiktif ditanam
 * langsung di DB tes sebagai entri berversi (penulis = DPJP).
 */

async function inpatient(doctor: Account) {
  const p = await createPatient('RSFA', { name: `Ny. Resume Api ${newId().slice(-4)} Fiktif` });
  return inTenant(TENANTS.RSFA, async (tx) => {
    const unit = await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } });
    const started = new Date(Date.now() - 3 * 86_400_000);
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: TENANTS.RSFA,
        number: `RI-E2E-${newId().slice(-10)}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: unit.id,
        plannedAt: started,
        arrivedAt: started,
        startedAt: started,
      },
    });
    const pid = newId();
    await tx.encounterParticipant.create({
      data: { id: pid, tenantId: TENANTS.RSFA, encounterId: enc.id, userId: doctor.id, role: 'dpjp_utama' },
    });
    await tx.accessRelationship.create({
      data: {
        id: newId(),
        tenantId: TENANTS.RSFA,
        userId: doctor.id,
        patientId: p.id,
        kind: 'dpjp',
        validFrom: new Date(Date.now() - 60_000),
        sourceType: 'encounter_participant',
        sourceId: pid,
      },
    });
    const meta = (at: Date) => {
      const id = newId();
      return {
        id,
        rootId: id,
        tenantId: TENANTS.RSFA,
        patientId: p.id,
        encounterId: enc.id,
        occurredAt: at,
        authorUserId: doctor.id,
        authorRole: 'dokter',
      };
    };
    for (const [h, c] of [
      [70, { temp: 38.9, hr: 112, rr: 28, sbp: 150, dbp: 95, spo2: 91, onOxygen: false, consciousness: 'A' }],
      [2, { temp: 36.8, hr: 80, rr: 18, sbp: 120, dbp: 80, spo2: 97, onOxygen: false, consciousness: 'A' }],
    ] as const) {
      await tx.observation.create({
        data: {
          ...meta(new Date(Date.now() - h * 3_600_000)),
          category: 'vital',
          display: 'Tanda vital',
          components: c,
          ewsScore: 0,
          ewsMaxParam: 0,
        },
      });
    }
    await tx.cpptEntry.create({
      data: {
        ...meta(new Date(Date.now() - 69 * 3_600_000)),
        ppa: 'dpjp',
        format: 'soap',
        content: {
          format: 'soap',
          s: 'Demam 4 hari, batuk berdahak, sesak napas',
          o: 'Ronki basah paru kanan bawah',
          a: 'Pneumonia komunitas',
          p: 'Antibiotik IV',
        },
      },
    });
    await tx.condition.create({
      data: {
        ...meta(new Date(Date.now() - 68 * 3_600_000)),
        kind: 'encounter',
        role: 'utama',
        code: 'J18.9',
        display: 'Pneumonia, tidak spesifik',
        clinicalStatus: 'active',
      },
    });
    return { encounterId: enc.id, name: p.id };
  });
}

test('resume mode api: himpun → isian DPJP → rekonsiliasi → 12 butir → TTE terkunci → addendum', async ({
  page,
}) => {
  const doctor = await createAccount({ displayName: 'dr. Resume Api E2E Fiktif, Sp.PD' });
  await inTenant(TENANTS.RSFA, async (tx) => {
    const r = await tx.role.findFirstOrThrow({ where: { code: 'dokter' } });
    const u = await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } });
    await tx.staffAssignment.create({
      data: { id: newId(), tenantId: TENANTS.RSFA, userId: doctor.id, roleId: r.id, unitId: u.id },
    });
  });
  const e = await inpatient(doctor);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (m) => {
    const where = `${m.text()} ${m.location().url}`;
    if (m.type() === 'error' && !where.includes('favicon')) errors.push(where);
  });

  await loginAs(page, doctor, `/klinis/resume/${e.encounterId}`);
  await expect(page.getByRole('heading', { name: /Resume medis · / })).toBeVisible();
  await page.getByRole('button', { name: 'Himpun resume' }).click();
  await expect(page.getByText(/Draf resume dihimpun/)).toBeVisible();
  // Isi = data sumber, berlabel sumber.
  const anamnesis = page.getByRole('article', { name: 'Alasan masuk dan anamnesis singkat' });
  await expect(anamnesis.getByText('Demam 4 hari, batuk berdahak, sesak napas')).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Pemeriksaan fisik penting' }).getByText(/TD 150\/95 mmHg/),
  ).toBeVisible();
  await expect(page.getByText('J18.9')).toBeVisible();
  // TTE terkunci sebelum lengkap.
  await expect(page.getByRole('button', { name: 'Tanda tangani resume (TTE)' })).toBeDisabled();

  await page.getByRole('combobox', { name: 'Cara pulang' }).selectOption('pulang');
  await page.getByRole('textbox', { name: 'Kondisi pulang' }).fill('Membaik');
  await page
    .getByRole('textbox', { name: 'Catatan penunjang (mis. "tidak ada pemeriksaan penunjang")' })
    .fill('Tidak ada pemeriksaan penunjang selama dirawat');
  await page.getByRole('textbox', { name: 'Catatan terapi' }).fill('Seftriakson 2 g IV 1×24 jam H1–H3');
  await page
    .getByRole('textbox', { name: 'Edukasi pasien dan keluarga' })
    .fill('Cara minum obat dan tanda bahaya sesak');
  await page
    .getByRole('textbox', { name: 'Instruksi pulang dan tanda bahaya' })
    .fill('Kembali bila demam ≥ 38,5 °C atau sesak');
  await page
    .getByRole('textbox', { name: 'Tindak lanjut / jadwal kontrol' })
    .fill('Kontrol Poli Penyakit Dalam 7 hari');
  await page.getByRole('textbox', { name: 'Nama obat' }).fill('Sefiksim 200 mg');
  await page.getByRole('textbox', { name: 'Aturan pakai' }).fill('2×1 PO · 4 hari');
  // Tanpa scroll horizontal di desktop maupun tablet.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Tambah obat' }).click();
  await page.getByRole('button', { name: 'Simpan draf resume' }).click();
  await expect(page.getByText('Draf resume tersimpan.')).toBeVisible();
  await page.getByRole('button', { name: 'Konfirmasi DPJP' }).click();
  await expect(page.getByText('Rekonsiliasi obat pulang dikonfirmasi.')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Kelengkapan resume' })).toHaveAttribute(
    'aria-valuenow',
    '12',
  );

  await page.getByRole('button', { name: 'Tanda tangani resume (TTE)' }).click();
  await expect(page.getByText(/Resume final · versi 1/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cetak PDF resume' })).toBeVisible();
  // Setelah final: isian terkunci, hanya addendum.
  await expect(page.getByRole('button', { name: 'Simpan draf resume' })).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Tambah addendum (isi resume final tidak berubah)' })
    .fill('Hasil kultur sputum keluar setelah pulang: S. pneumoniae sensitif seftriakson');
  await page.getByRole('button', { name: 'Tanda tangani addendum (TTE)' }).click();
  await expect(page.getByText('Addendum tersimpan · TTE diminta.')).toBeVisible();

  const rows = await inTenant(TENANTS.RSFA, (tx) =>
    tx.dischargeSummary.findMany({ where: { encounterId: e.encounterId }, select: { addendumOf: true } }),
  );
  expect(rows.filter((r) => r.addendumOf === null)).toHaveLength(1);
  expect(rows.filter((r) => r.addendumOf !== null)).toHaveLength(1);
  expect(errors).toEqual([]);
});
