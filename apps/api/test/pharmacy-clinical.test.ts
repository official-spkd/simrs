/**
 * Fase 4 · potongan 4.5 · S04 farmasi klinis: antrean kiriman CPOE ke depo, terima resep (nomor R), CDS ulang saat
 * telaah dengan override dokter wajib ditinjau, `setujui` diblokir `CDS_UNRESOLVED`, override apoteker wajib alasan,
 * intervensi tidak mengubah resep, jawaban dokter penulis, stok depo dari ledger, lingkup unit depo, isolasi tenant,
 * audit. Data fiktif.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createPrismaClient,
  seedClinicalMasters,
  seedHospitalStructure,
  seedSupportMasters,
  seedSupportStock,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  createTestPatient,
  createTestTenant,
  createTestUser,
  login,
  type Tokens,
  testDb,
} from './helpers';

let app: NestExpressApplication;
let A: { id: string; code: string };
let B: { id: string; code: string };
const tok: Record<string, Tokens> = {};
const users: Record<string, string> = {};

const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}, key?: string) => {
      const req = http().post(`/api/v1${url}`).set(auth());
      return (key ? req.set('Idempotency-Key', key) : req).send(body);
    },
  };
};

async function supportTenant(stockActor: (t: { id: string; code: string }) => Promise<string>) {
  const t = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, t.id, async (tx) => {
      await seedHospitalStructure(tx, t.id);
      await seedClinicalMasters(tx, t.id);
      await seedSupportMasters(tx, t.id);
    });
    const actor = await stockActor(t);
    await withTenant(owner, t.id, (tx) => seedSupportStock(tx, t.id, actor));
  } finally {
    await owner.$disconnect();
  }
  return t;
}

async function addUser(who: string, t: { id: string; code: string }, role: string, unitCode?: string) {
  const unitId = unitCode
    ? (await run(t.id, (tx) => tx.unit.findFirstOrThrow({ where: { code: unitCode } }))).id
    : undefined;
  const user = await createTestUser(t.id, { roles: [{ code: role, unitId }], tenantCode: t.code });
  users[who] = user.id;
  tok[who] = await login(app, user);
  return user.id;
}

const drugId = (t: { id: string }, name: string) =>
  run(t.id, async (tx) => (await tx.drug.findFirstOrThrow({ where: { name } })).id);
const depot = (t: { id: string }, code: string) =>
  run(t.id, async (tx) => (await tx.stockLocation.findFirstOrThrow({ where: { code } })).id);

let seq = 0;
/** Pasien rawat inap aktif di bangsal MELATI, opsional beralergi zat `allergy`. */
async function inpatient(t: { id: string }, allergy?: string) {
  const p = await createTestPatient(t.id, { name: 'Pasien Farmasi Fiktif' });
  seq += 1;
  return run(t.id, async (tx) => {
    const unit = await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } });
    const occupied = (
      await tx.bedAssignment.findMany({ where: { endedAt: null }, select: { locationId: true } })
    ).map((a) => a.locationId);
    const bed = await tx.location.findFirstOrThrow({
      where: { kind: 'bed', unitId: unit.id, id: { notIn: occupied } },
      orderBy: { code: 'asc' },
    });
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: t.id,
        number: `RI-2610-${String(Date.now() % 1e5).padStart(5, '0')}${seq}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: unit.id,
        plannedAt: new Date(),
      },
    });
    await tx.bedAssignment.create({
      data: {
        id: newId(),
        tenantId: t.id,
        encounterId: enc.id,
        patientId: p.id,
        locationId: bed.id,
        startedAt: new Date(),
      },
    });
    if (allergy) {
      const substance = await tx.drugSubstance.findFirstOrThrow({ where: { code: allergy } });
      const id = newId();
      await tx.allergyIntolerance.create({
        data: {
          id,
          rootId: id,
          tenantId: t.id,
          patientId: p.id,
          encounterId: enc.id,
          occurredAt: new Date(Date.now() - 60_000),
          authorUserId: t.id === A.id ? (users.dokter as string) : (users.dokterB as string),
          authorRole: 'dokter',
          kind: 'alergi',
          substanceId: substance.id,
          category: 'obat',
          criticality: 'tinggi',
          reaction: 'Ruam',
        },
      });
    }
    return { patientId: p.id, encounterId: enc.id };
  });
}

const med = (drug: string, override: string | null = null) => ({
  type: 'obat',
  drugId: drug,
  compound: null,
  dose: '500 mg',
  route: 'oral',
  frequency: '3x1',
  customTimes: null,
  durationDays: 5,
  instructions: null,
  override,
});

/** Dokter mengirim order obat (CPOE) → id kiriman. */
async function submit(who: string, encounterId: string, items: object[]): Promise<string> {
  const r = await as(who)
    .post('/orders/submit', { encounterId, orderSetId: null, items }, newId())
    .expect(201);
  return r.body.id as string;
}

const OVERRIDE = 'Riwayat sefadroksil sebelumnya tanpa reaksi; manfaat lebih besar';

beforeAll(async () => {
  app = await createTestApp();
  A = await supportTenant((t) => addUser('apoteker', t, 'apoteker', 'FARMASI'));
  B = await supportTenant((t) => addUser('apotekerB', t, 'apoteker', 'FARMASI'));
  await addUser('apotekerIgd', A, 'apoteker', 'IGD');
  await addUser('dokter', A, 'dokter', 'MELATI');
  await addUser('dokterLain', A, 'dokter', 'MELATI');
  await addUser('perawat', A, 'perawat', 'MELATI');
  await addUser('dokterB', B, 'dokter', 'MELATI');
});

afterAll(async () => {
  await app?.close();
});

describe('antrean dan terima resep', () => {
  it('kiriman CPOE muncul di antrean depo rawat inap; terima → R-nomor, telaah, riwayat status, event, audit; dua kali → 409', async () => {
    const e = await inpatient(A);
    const groupId = await submit('dokter', e.encounterId, [
      med(await drugId(A, 'Parasetamol 500 mg tablet')),
    ]);

    const incoming = await as('apoteker').get('/pharmacy/incoming').expect(200);
    const row = incoming.body.find((r: { orderGroupId: string }) => r.orderGroupId === groupId);
    expect(row).toMatchObject({
      encounter: { id: e.encounterId, class: 'IMP' },
      stockLocation: { name: 'Depo farmasi rawat inap' },
      needsReview: false,
      items: [expect.objectContaining({ name: 'Parasetamol 500 mg tablet', status: 'aktif' })],
    });
    // Apoteker depo IGD tidak melihat kiriman rawat inap.
    const igd = await as('apotekerIgd').get('/pharmacy/incoming').expect(200);
    expect(igd.body.some((r: { orderGroupId: string }) => r.orderGroupId === groupId)).toBe(false);

    const accepted = await as('apoteker')
      .post('/pharmacy/prescriptions', { orderGroupId: groupId, stockLocationId: row.stockLocation.id })
      .expect(201);
    expect(accepted.body).toMatchObject({
      prescriptionNo: expect.stringMatching(/^R-\d{4}-\d{4}$/),
      status: 'telaah',
      setting: 'rawat_inap',
      acceptedBy: { userId: users.apoteker },
      items: [
        expect.objectContaining({
          name: 'Parasetamol 500 mg tablet',
          // Stok layak di depo RI dari ledger seed: ceil(1000/4) = 250; minimum profil formularium 5.
          stock: { usable: 250, minQuantity: 5 },
        }),
      ],
    });
    // Tanpa temuan: satu catatan info yang tidak menahan.
    expect(accepted.body.alerts.every((a: { blocking: boolean }) => !a.blocking)).toBe(true);

    const again = await as('apoteker')
      .post('/pharmacy/prescriptions', { orderGroupId: groupId, stockLocationId: row.stockLocation.id })
      .expect(409);
    expect(again.body.message).toContain(accepted.body.prescriptionNo);
    const after = await as('apoteker').get('/pharmacy/incoming').expect(200);
    expect(after.body.some((r: { orderGroupId: string }) => r.orderGroupId === groupId)).toBe(false);

    const stored = await run(A.id, async (tx) => ({
      history: await tx.pharmacyPrescriptionStatusHistory.findMany({
        where: { pharmacyPrescriptionId: accepted.body.id },
        select: { fromStatus: true, toStatus: true, changedBy: true },
      }),
      event: await tx.domainEvent.findFirst({
        where: {
          name: 'pharmacy.service_started',
          payload: { path: ['pharmacyPrescriptionId'], equals: accepted.body.id },
        },
        select: { payload: true },
      }),
      audit: await tx.auditEvent.findFirst({
        where: { resourceType: 'pharmacy_prescription', resourceId: accepted.body.id, action: 'create' },
      }),
    }));
    expect(stored.history).toEqual([{ fromStatus: null, toStatus: 'telaah', changedBy: users.apoteker }]);
    expect(stored.event?.payload).toMatchObject({ orderGroupId: groupId, setting: 'rawat_inap' });
    expect(stored.audit?.patientId).toBe(e.patientId);

    const queue = await as('apoteker').get('/pharmacy/prescriptions?status=telaah').expect(200);
    expect(queue.body).toContainEqual(
      expect.objectContaining({ id: accepted.body.id, blockingAlerts: 0, highAlert: false }),
    );
  });

  it('perawat 403; apoteker IGD 403 atas resep depo farmasi; tenant lain 404 (RLS)', async () => {
    const e = await inpatient(A);
    const groupId = await submit('dokter', e.encounterId, [med(await drugId(A, 'Metformin 500 mg tablet'))]);
    const ri = await depot(A, 'DEPO-RI');
    const p = await as('apoteker')
      .post('/pharmacy/prescriptions', { orderGroupId: groupId, stockLocationId: ri })
      .expect(201);
    await as('perawat').get('/pharmacy/incoming').expect(403);
    await as('perawat').get(`/pharmacy/prescriptions/${p.body.id}`).expect(403);
    await as('apotekerIgd').get(`/pharmacy/prescriptions/${p.body.id}`).expect(403);
    await as('apotekerB').get(`/pharmacy/prescriptions/${p.body.id}`).expect(404);
    const igdDepot = await depot(A, 'DEPO-IGD');
    const e2 = await inpatient(A);
    const g2 = await submit('dokter', e2.encounterId, [med(await drugId(A, 'Metformin 500 mg tablet'))]);
    await as('apoteker')
      .post('/pharmacy/prescriptions', { orderGroupId: g2, stockLocationId: igdDepot })
      .expect(403);
  });
});

describe('CDS saat telaah dan keputusan', () => {
  it('override dokter atas alergi wajib ditinjau: setujui 409 CDS_UNRESOLVED; override apoteker tanpa alasan ditolak; konfirmasi → setujui → penyiapan', async () => {
    const e = await inpatient(A, 'amoksisilin');
    const groupId = await submit('dokter', e.encounterId, [
      med(await drugId(A, 'Sefadroksil 500 mg kapsul'), OVERRIDE),
    ]);
    const p = await as('apoteker')
      .post('/pharmacy/prescriptions', { orderGroupId: groupId, stockLocationId: await depot(A, 'DEPO-RI') })
      .expect(201);
    expect(p.body.allergies.length).toBeGreaterThan(0);
    const alert = p.body.alerts.find((a: { kind: string }) => a.kind === 'alergi');
    expect(alert).toMatchObject({
      level: 'mayor',
      prescriberOverride: true,
      status: 'override',
      blocking: true,
      decision: null,
    });
    expect(alert.detail).toContain(OVERRIDE);

    const aspects = { administratif: true, farmasetik: true, klinis: true };
    const blocked = await as('apoteker')
      .post(`/pharmacy/prescriptions/${p.body.id}/reviews`, {
        aspects,
        decision: 'setujui',
        reason: null,
        medicationRequestIds: [],
      })
      .expect(409);
    expect(blocked.body.code).toBe('CDS_UNRESOLVED');
    expect(blocked.body.details.alertIds).toEqual([alert.id]);

    const noReason = await as('apoteker').post(
      `/pharmacy/prescriptions/${p.body.id}/alerts/${alert.id}/decision`,
      { decision: 'override', reason: 'singkat' },
    );
    expect(noReason.status).toBeGreaterThanOrEqual(400);
    expect(noReason.status).toBeLessThan(500);

    const decided = await as('apoteker')
      .post(`/pharmacy/prescriptions/${p.body.id}/alerts/${alert.id}/decision`, {
        decision: 'konfirmasi',
        reason: null,
      })
      .expect(200);
    expect(decided.body.alerts.find((a: { id: string }) => a.id === alert.id)).toMatchObject({
      status: 'teratasi',
      blocking: false,
      decision: { decision: 'konfirmasi', by: { userId: users.apoteker } },
    });
    await as('apoteker')
      .post(`/pharmacy/prescriptions/${p.body.id}/alerts/${alert.id}/decision`, {
        decision: 'konfirmasi',
        reason: null,
      })
      .expect(409);

    // Evaluasi ulang membawa tindak lanjut final atas temuan yang sama.
    const re = await as('apoteker').post(`/pharmacy/prescriptions/${p.body.id}/cds/evaluate`).expect(200);
    const carried = re.body.alerts.find((a: { kind: string }) => a.kind === 'alergi');
    expect(carried.id).not.toBe(alert.id);
    expect(carried).toMatchObject({ status: 'teratasi', decision: { decision: 'konfirmasi', reason: null } });

    const ok = await as('apoteker')
      .post(`/pharmacy/prescriptions/${p.body.id}/reviews`, {
        aspects,
        decision: 'setujui',
        reason: null,
        medicationRequestIds: [],
      })
      .expect(201);
    expect(ok.body).toMatchObject({
      status: 'penyiapan',
      reviews: [expect.objectContaining({ decision: 'setujui' })],
    });
    // Setelah telaah selesai tidak ada keputusan lagi.
    await as('apoteker').post(`/pharmacy/prescriptions/${p.body.id}/cds/evaluate`).expect(409);

    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findMany({
        where: {
          patientId: e.patientId,
          resourceType: { in: ['pharmacy_prescription', 'pharmacy_cds_alert'] },
        },
        select: { action: true, resourceType: true },
      }),
    );
    expect(audit).toEqual(
      expect.arrayContaining([
        { action: 'update', resourceType: 'pharmacy_cds_alert' },
        { action: 'verify', resourceType: 'pharmacy_prescription' },
      ]),
    );
  });

  it('obat kewaspadaan tinggi → info high-alert (tidak menahan); tahan wajib alasan → ditahan', async () => {
    const e = await inpatient(A);
    const groupId = await submit('dokter', e.encounterId, [
      {
        ...med(await drugId(A, 'Insulin glargine 100 unit/mL pen')),
        dose: '10 unit',
        route: 'subkutan',
        frequency: '1x1_pagi',
      },
    ]);
    const p = await as('apoteker')
      .post('/pharmacy/prescriptions', { orderGroupId: groupId, stockLocationId: await depot(A, 'DEPO-RI') })
      .expect(201);
    expect(p.body.alerts).toContainEqual(
      expect.objectContaining({ kind: 'high-alert', level: 'info', blocking: false }),
    );
    expect(p.body.items[0].stock).toEqual({ usable: 4, minQuantity: 5 });
    const aspects = { administratif: true, farmasetik: true, klinis: false };
    await as('apoteker')
      .post(`/pharmacy/prescriptions/${p.body.id}/reviews`, {
        aspects,
        decision: 'tahan',
        reason: null,
        medicationRequestIds: [],
      })
      .expect(400);
    const held = await as('apoteker')
      .post(`/pharmacy/prescriptions/${p.body.id}/reviews`, {
        aspects,
        decision: 'tahan',
        reason: 'Menunggu konfirmasi gula darah pagi dari bangsal',
        medicationRequestIds: [],
      })
      .expect(201);
    expect(held.body.status).toBe('ditahan');
    const queue = await as('apoteker').get('/pharmacy/prescriptions').expect(200);
    expect(queue.body).toContainEqual(
      expect.objectContaining({ id: p.body.id, status: 'ditahan', highAlert: true }),
    );
  });
});

describe('intervensi apoteker', () => {
  it('intervensi tidak mengubah resep; dokter penulis diberi notifikasi tanpa PHI dan menjawab sekali; dokter lain 403', async () => {
    const e = await inpatient(A);
    const groupId = await submit('dokter', e.encounterId, [
      {
        ...med(await drugId(A, 'Omeprazol 40 mg injeksi')),
        dose: '40 mg',
        route: 'intravena',
        frequency: '1x1_pagi',
      },
    ]);
    const p = await as('apoteker')
      .post('/pharmacy/prescriptions', { orderGroupId: groupId, stockLocationId: await depot(A, 'DEPO-RI') })
      .expect(201);
    const item = p.body.items[0];
    await as('apoteker')
      .post(`/pharmacy/prescriptions/${p.body.id}/interventions`, {
        kind: 'ubah_dosis',
        medicationRequestIds: [newId()],
        recommendation: 'Turunkan dosis sesuai fungsi ginjal pasien',
      })
      .expect(400);
    const r = await as('apoteker')
      .post(`/pharmacy/prescriptions/${p.body.id}/interventions`, {
        kind: 'ganti_obat',
        medicationRequestIds: [item.id],
        recommendation: 'Usul ganti ke pantoprazol 40 mg injeksi (stok omeprazol menipis)',
      })
      .expect(201);
    const intervention = r.body.interventions[0];
    expect(intervention).toMatchObject({
      kind: 'ganti_obat',
      prescriber: { userId: users.dokter },
      by: { userId: users.apoteker },
      response: null,
    });
    // Resep tidak berubah: item dan status CPOE sama persis.
    expect(
      r.body.items.map((i: { id: string; dose: string; status: string }) => [i.id, i.dose, i.status]),
    ).toEqual([[item.id, item.dose, 'aktif']]);
    expect(r.body.status).toBe('telaah');

    const note = await run(A.id, (tx) =>
      tx.notification.findFirst({
        where: { recipientUserId: users.dokter, kind: 'pharmacy.intervention' },
        orderBy: { createdAt: 'desc' },
        select: { title: true, body: true },
      }),
    );
    expect(note?.body).toContain(p.body.prescriptionNo);
    expect(note?.body).not.toContain('Pasien Farmasi Fiktif');

    await as('dokterLain')
      .post(`/pharmacy/interventions/${intervention.id}/response`, { response: 'diterima', note: null })
      .expect(403);
    await as('dokter')
      .post(`/pharmacy/interventions/${intervention.id}/response`, { response: 'ditolak', note: null })
      .expect(400);
    await as('dokter')
      .post(`/pharmacy/interventions/${intervention.id}/response`, { response: 'diterima', note: null })
      .expect(200);
    await as('dokter')
      .post(`/pharmacy/interventions/${intervention.id}/response`, { response: 'diterima', note: null })
      .expect(409);
    const view = await as('apoteker').get(`/pharmacy/prescriptions/${p.body.id}`).expect(200);
    expect(view.body.interventions[0].response).toMatchObject({
      response: 'diterima',
      by: { userId: users.dokter },
    });
  });
});
