import { expect, type Page, test } from '@playwright/test';
import { CONSENT_INFORMATION_ITEMS, newId } from '@simrs/shared';
import { createAccount, createPatient, inTenant, loginAs, TENANTS } from './support/accounts';

/**
 * Layar W5a · Tablet persetujuan tindakan mode api (rencana fase 3 §W5a, ADR-0058), data fiktif. Tablet memakai sesi
 * staf (keputusan fase 3 #20):
 * 1. DPJP memilih kunjungan, menyusun draf dari templat (tujuh butir), pasien menyatakan paham lalu menandatangani
 *    (goresan PNG), saksi keluarga mengetik nama.
 * 2. Perawat penanggung jawab membuka draf yang sama dengan sesinya sendiri dan beratestasi sebagai saksi petugas.
 * 3. DPJP menandatangani (TTE): persetujuan final, PDF ber-TTE sah (worker + mock TTE).
 * 4. Draf kedua ditolak pasien dengan alasan → entri `tolak` + TTE; persetujuan pertama dicabut → entri `dicabut`.
 */

/** Pasien rawat inap Melati dengan tim perawatan: DPJP utama + perawat penanggung jawab (relasi akses ABAC). */
async function encounterWithTeam(patientId: string, team: { dpjp: string; perawat: string }) {
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
        startedAt: new Date(),
      },
    });
    for (const [userId, role, kind] of [
      [team.dpjp, 'dpjp_utama', 'dpjp'],
      [team.perawat, 'perawat_pj', 'perawat_penanggung_jawab'],
    ] as const) {
      const participantId = newId();
      await tx.encounterParticipant.create({
        data: { id: participantId, tenantId: TENANTS.RSFA, encounterId: id, userId, role },
      });
      await tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: TENANTS.RSFA,
          userId,
          patientId,
          kind,
          sourceType: 'encounter_participant',
          sourceId: participantId,
        },
      });
    }
    // Syarat final persetujuan (3.8, `CONSENT_EDUCATION_REQUIRED`): edukasi tindakan terkini terverifikasi paham,
    // dicatat perawat PJ lewat formulir P07 `edukasi_terintegrasi` di kunjungan ini.
    const education = await tx.formDefinition.findFirstOrThrow({
      where: { code: 'edukasi_terintegrasi', status: 'published' },
      select: { id: true },
    });
    const responseId = newId();
    await tx.formResponse.create({
      data: {
        id: responseId,
        tenantId: TENANTS.RSFA,
        patientId,
        definitionId: education.id,
        formCode: 'edukasi_terintegrasi',
        rootId: responseId,
        answers: { topik: ['tindakan'], sasaran: 'keduanya', evaluasi: 'paham' },
        createdBy: team.perawat,
        encounterId: id,
      },
    });
    return id;
  });
}

/** Isi draf baru: tindakan + tujuh butir informasi, lalu buka draf di tablet. */
async function createDraft(page: Page, procedure: string) {
  const form = page.getByRole('region', { name: 'Draf persetujuan baru' });
  await form.getByLabel('Tindakan yang akan dilakukan').fill(procedure);
  for (const [k, item] of CONSENT_INFORMATION_ITEMS.entries()) {
    await form.getByLabel(`${k + 1}. ${item.label}`).fill(`${item.label} untuk ${procedure} (uji fiktif).`);
  }
  await form.getByRole('button', { name: 'Simpan draf dan buka di tablet' }).click();
  await expect(page).toHaveURL(/\/tablet\/persetujuan\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: procedure, level: 1 })).toBeVisible();
}

test.describe('Tablet persetujuan mode api (W5a)', () => {
  test('dua tanda tangan + saksi petugas → TTE dokter; penolakan beralasan; pencabutan', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'cukup di proyek desktop');
    test.setTimeout(150_000);
    const [dokter, perawat] = await Promise.all([
      createAccount({ roles: ['dokter'], displayName: 'dr. Persetujuan E2E Fiktif' }),
      createAccount({ roles: ['perawat'], displayName: 'Ns. Saksi E2E Fiktif' }),
    ]);
    const suffix = newId().slice(-6);
    const patientName = `Tn. Persetujuan ${suffix} Fiktif`;
    const patient = await createPatient('RSFA', { name: patientName, sex: 'male', birthDate: '1968-02-11' });
    const encounterId = await encounterWithTeam(patient.id, { dpjp: dokter.id, perawat: perawat.id });

    // --- 1. DPJP: pilih kunjungan, susun draf, pasien paham + tanda tangan, saksi keluarga ---
    await loginAs(page, dokter, '/tablet/persetujuan');
    await expect(page.getByRole('heading', { name: 'Pilih kunjungan pasien', level: 1 })).toBeVisible();
    await page
      .getByRole('region', { name: 'Kunjungan berjalan' })
      .getByRole('link', { name: new RegExp(patientName) })
      .click();
    await expect(page.getByLabel('Identitas pasien')).toContainText(patientName);
    await createDraft(page, 'Pemasangan kateter vena sentral');
    const draftUrl = page.url();

    const next = (name: string) => page.getByRole('button', { name, exact: true });
    await expect(next('Lanjut ke tanda tangan')).toBeDisabled();
    for (const item of CONSENT_INFORMATION_ITEMS) {
      await page.getByRole('checkbox', { name: `Saya memahami: ${item.label}` }).check();
    }
    await next('Lanjut ke tanda tangan').click();

    await expect(page.getByLabel('Nama pasien')).toHaveValue(patientName);
    const pad = page.getByRole('img', { name: 'Tanda tangan pasien' });
    const box = await pad.boundingBox();
    if (!box) throw new Error('Bantalan tanda tangan tidak tampil');
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
    await page.mouse.down();
    for (const [x, y] of [
      [0.35, 0.3],
      [0.5, 0.7],
      [0.65, 0.35],
      [0.8, 0.6],
    ] as const) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 8 });
    }
    await page.mouse.up();
    await expect(page.getByText(`${patientName} · goresan`)).toBeVisible();
    await next('Lanjut ke saksi').click();

    await page.getByRole('checkbox', { name: 'Ada saksi keluarga' }).check();
    await page.getByLabel('Nama saksi keluarga').fill('Ny. Saksi Keluarga Fiktif');
    await page.getByLabel('Hubungan saksi dengan pasien').fill('istri');
    await page.getByLabel('Atau ketik nama lengkap sebagai tanda tangan').fill('Ny. Saksi Keluarga Fiktif');
    await page.getByRole('button', { name: 'Pakai nama ketik' }).click();
    await page.getByRole('button', { name: 'Simpan tanda tangan' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Tanda tangan tersimpan' })).toBeVisible();
    await expect(next('Lanjut ke TTE dokter')).toBeDisabled();
    await expect(page.getByText('Menunggu atestasi saksi petugas.')).toBeVisible();

    // --- 2. Perawat PJ (sesi sendiri) beratestasi sebagai saksi petugas ---
    const nurseContext = await browser.newContext();
    const nurse = await nurseContext.newPage();
    try {
      await loginAs(nurse, perawat, new URL(draftUrl).pathname);
      await nurse
        .getByRole('button', { name: 'Saya (Ns. Saksi E2E Fiktif) hadir sebagai saksi petugas' })
        .click();
      await expect(nurse.getByText('Saksi petugas tercatat', { exact: true })).toBeVisible();
      // Perawat tidak memegang `consent.sign`: tidak ada tombol TTE atau penolakan.
      await expect(nurse.getByRole('button', { name: 'Pasien menolak tindakan' })).toHaveCount(0);
    } finally {
      await nurseContext.close();
    }

    // --- 3. DPJP: TTE → final, PDF ber-TTE sah ---
    await page.reload();
    const sign = next('Tanda tangani (TTE)');
    await expect(sign).toBeEnabled();
    await sign.click();
    const done = page.getByRole('status').filter({ hasText: 'Dokumen final' });
    await expect(done).toBeVisible();
    await expect(done).toContainText('TTE sah', { timeout: 45_000 });
    await page.screenshot({ path: testInfo.outputPath('persetujuan-final.png'), fullPage: true });

    const stored = await inTenant(TENANTS.RSFA, (tx) =>
      tx.consent.findFirstOrThrow({
        where: { encounterId, decision: 'setuju' },
        select: { id: true, documentId: true, signatures: { select: { signerKind: true, method: true } } },
      }),
    );
    expect(stored.signatures.map((s) => `${s.signerKind}:${s.method}`).sort()).toEqual([
      'pasien:goresan',
      'saksi_keluarga:nama',
      'saksi_petugas:nama',
    ]);

    // --- 4. Penolakan beralasan pada draf kedua, lalu pencabutan persetujuan pertama ---
    await page.getByRole('link', { name: 'Daftar persetujuan' }).click();
    const records = page.getByRole('region', { name: 'Persetujuan tercatat' });
    await expect(records.getByText('Pemasangan kateter vena sentral')).toBeVisible();
    await expect(records.getByText('TTE sah')).toBeVisible();
    await createDraft(page, 'Transfusi darah PRC');
    await page.getByRole('button', { name: 'Pasien menolak tindakan' }).click();
    await page.getByLabel(/Alasan penolakan/).fill('Pasien menolak transfusi karena keyakinan pribadi');
    await page.getByRole('button', { name: 'Catat penolakan' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Pasien menolak tindakan' })).toContainText(
      'Alasan: Pasien menolak transfusi karena keyakinan pribadi',
    );

    await page.getByRole('link', { name: 'Daftar persetujuan' }).click();
    await records.getByRole('button', { name: 'Pasien mencabut persetujuan' }).click();
    await records.getByLabel(/Alasan pencabutan/).fill('Pasien berubah pikiran setelah diskusi keluarga');
    await records.getByLabel('Nama lengkap yang mencabut (tanda tangan ketik nama)').fill(patientName);
    await records.getByRole('button', { name: 'Catat pencabutan (TTE)' }).click();
    await expect(records.getByRole('status')).toContainText('dicabut');
    await expect(records.getByText('Dicabut', { exact: true }).first()).toBeVisible();

    const decisions = await inTenant(TENANTS.RSFA, (tx) =>
      tx.consent.findMany({ where: { encounterId }, select: { decision: true } }),
    );
    expect(decisions.map((d) => d.decision).sort()).toEqual(['dicabut', 'setuju', 'tolak']);
  });
});
