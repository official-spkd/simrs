import { expect, type Page, test } from '@playwright/test';
import { isoDateJakarta, newId } from '@simrs/shared';
import { type Account, createAccount, createPatient, inTenant, loginAs, TENANTS } from './support/accounts';
import { ensureRsfaSchedule } from './support/schedule';

/**
 * K01/K02 · Layar Pemeriksaan poli mode api (W1): perawat mengukur tanda vital, dokter memanggil pasien (task 4),
 * menulis SOAP + ICD-10, lalu "Tanda tangani dan selesai" → CPPT final, diagnosis, resume rawat jalan ber-TTE, kunjungan
 * selesai, dan tiket poli selesai (task 5). Semua lewat API sungguhan; data fiktif dibuat langsung di DB tes.
 */

async function assign(account: Account, role: string, unitCode: string) {
  await inTenant(TENANTS.RSFA, async (tx) => {
    const r = await tx.role.findFirstOrThrow({ where: { code: role } });
    const unit = await tx.unit.findFirstOrThrow({ where: { code: unitCode } });
    await tx.staffAssignment.create({
      data: { id: newId(), tenantId: TENANTS.RSFA, userId: account.id, roleId: r.id, unitId: unit.id },
    });
  });
}

/** Kunjungan rawat jalan hari ini di Poli Penyakit Dalam dengan tiket menunggu; dokter = DPJP kunjungan. */
async function poliVisit(doctor: Account) {
  const p = await createPatient('RSFA', { name: `Tn. Poli Api ${newId().slice(-4)} Fiktif`, sex: 'male' });
  return inTenant(TENANTS.RSFA, async (tx) => {
    const svc = await tx.queueService.findFirstOrThrow({ where: { code: 'PD' } });
    const today = new Date(`${isoDateJakarta(new Date())}T00:00:00.000Z`);
    // Nomor acak 600–999 (dua proyek Playwright berjalan paralel di hari yang sama); bentrok → nomor lain.
    const used = new Set(
      (
        await tx.queueTicket.findMany({
          where: { serviceId: svc.id, serviceDate: today },
          select: { seq: true },
        })
      ).map((t) => t.seq),
    );
    let seq = 600 + Math.floor(Math.random() * 400);
    while (used.has(seq)) seq = 600 + Math.floor(Math.random() * 400);
    const ticketId = newId();
    await tx.queueTicket.create({
      data: {
        id: ticketId,
        tenantId: TENANTS.RSFA,
        serviceId: svc.id,
        serviceDate: today,
        seq,
        ticketNo: `PD-${String(seq).padStart(3, '0')}`,
        patientId: p.id,
        source: 'loket',
      },
    });
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: TENANTS.RSFA,
        number: `RJ-E2E-${newId().slice(-10)}`,
        patientId: p.id,
        encounterClass: 'AMB',
        status: 'arrived',
        unitId: svc.unitId as string,
        serviceId: svc.id,
        queueTicketId: ticketId,
        arrivedAt: new Date(Date.now() - 10 * 60_000),
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
    return { patientId: p.id, encounterId: enc.id, ticketId, ticketNo: `PD-${String(seq).padStart(3, '0')}` };
  });
}

/** Galat konsol + JS halaman (favicon 404 dari browser bukan galat layar). */
function noConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    const where = `${m.text()} ${m.location().url}`;
    if (m.type() === 'error' && !where.includes('favicon')) errors.push(where);
  });
  return errors;
}

test.beforeAll(async () => {
  await ensureRsfaSchedule();
});

test('poli mode api: TTV perawat → panggil → SOAP + ICD-10 → tanda tangani dan selesai (resume RJ + task 5)', async ({
  browser,
}) => {
  const doctor = await createAccount({ displayName: 'dr. Poli Api E2E Fiktif' });
  await assign(doctor, 'dokter', 'POLI-DALAM');
  const nurse = await createAccount({ displayName: 'Ns. Poli Api E2E Fiktif' });
  await assign(nurse, 'perawat', 'POLI-DALAM');
  const v = await poliVisit(doctor);

  // Perawat: tanda vital lengkap (NEWS2 dihitung server).
  const nctx = await browser.newContext();
  const np = await nctx.newPage();
  const nErrors = noConsoleErrors(np);
  await loginAs(np, nurse, `/klinis/poli?pasien=${v.patientId}`);
  await expect(np.getByRole('heading', { name: 'Pemeriksaan pasien' })).toBeVisible();
  await np.getByRole('button', { name: 'Ukur ulang tanda vital' }).click();
  await np.getByLabel('Tekanan darah (mmHg)').fill('150/95');
  await np.getByLabel('Nadi (x/mnt)').fill('88');
  await np.getByLabel('Suhu (°C)').fill('36,8');
  await np.getByLabel('SpO2 (%)').fill('98');
  await np.getByLabel('Napas (x/mnt)').fill('18');
  await np.getByRole('button', { name: 'Simpan tanda vital' }).click();
  await expect(np.getByText(/Tanda vital tersimpan/)).toBeVisible();
  await expect(np.getByText(/diukur perawat \d{2}\.\d{2}/)).toBeVisible();
  expect(nErrors).toEqual([]);
  await nctx.close();

  // Dokter: panggil (task 4), SOAP + ICD-10, tanda tangani dan selesai.
  const page = await browser.newPage();
  const errors = noConsoleErrors(page);
  await loginAs(page, doctor, `/klinis/poli?pasien=${v.patientId}`);
  await expect(page.getByText('150/95')).toBeVisible();
  await page.getByRole('button', { name: `Panggil pasien · ${v.ticketNo}` }).click();
  await expect(page.getByText(new RegExp(`${v.ticketNo} dipanggil`))).toBeVisible();
  await page.getByRole('button', { name: 'Mulai periksa' }).click();
  await expect(page.getByText(new RegExp(`Pemeriksaan ${v.ticketNo} dimulai`))).toBeVisible();

  // Tanpa scroll horizontal di desktop maupun tablet.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);
  await page.getByLabel('S · Subjektif').fill('Pusing dan tengkuk berat sejak 3 hari');
  await page.getByLabel('O · Objektif').fill('Tekanan darah tinggi, jantung dan paru dalam batas normal');
  await page.getByRole('button', { name: '+ Tambah diagnosis' }).click();
  await page.getByLabel('Pilih kode ICD-10').selectOption('I10');
  await page.getByLabel('Catatan rencana (P)').fill('Amlodipin 5 mg 1×1, diet rendah garam');
  await page.getByLabel('Tindak lanjut / kontrol').fill('Kontrol Poli Penyakit Dalam 2 minggu');
  await page.getByRole('button', { name: 'Simpan draf' }).click();
  await expect(page.getByText(/Draf disimpan \d{2}\.\d{2}/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Tanda tangani dan selesai' }).click();
  await expect(page.getByText(/Kunjungan selesai · ditandatangani/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: 'Buka resume' })).toBeVisible();

  const state = await inTenant(TENANTS.RSFA, async (tx) => ({
    enc: await tx.encounter.findUniqueOrThrow({ where: { id: v.encounterId }, select: { status: true } }),
    ticket: await tx.queueTicket.findUniqueOrThrow({ where: { id: v.ticketId }, select: { status: true } }),
    resume: await tx.dischargeSummary.count({ where: { encounterId: v.encounterId, kind: 'rawat_jalan' } }),
    dx: await tx.condition.count({ where: { encounterId: v.encounterId, code: 'I10', role: 'utama' } }),
  }));
  expect(state).toEqual({ enc: { status: 'finished' }, ticket: { status: 'done' }, resume: 1, dx: 1 });
  expect(errors).toEqual([]);
});
