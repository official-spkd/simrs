/**
 * Fase 4 · potongan 4.8 · S02 Mikrobiologi/PA + S10 diagnostik lain (ADR-0120): isolat per tahap + uji kepekaan,
 * validasi teknis → rilis klinis ber-TTE oleh dokter lain, urutan tahap + penguncian isolat (trigger), antibiogram,
 * laporan PA berversi + TTE + addendum, laporan S10 dari order + isian P07 + TTE, event, izin (403), ABAC, isolasi
 * tenant. Data fiktif.
 */
import {
  createPrismaClient,
  seedClinicalMasters,
  seedHospitalStructure,
  seedSupportMasters,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import {
  antibiogramSchema,
  diagnosticWorklistSchema,
  microOrderRecordSchema,
  microWorklistSchema,
  newId,
  paReportRecordSchema,
} from '@simrs/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
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
const units: Record<string, string> = {};

const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const owner = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => {
  const c = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  return withTenant(c, tenantId, fn).finally(() => c.$disconnect());
};
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}) => http().post(`/api/v1${url}`).set(auth()).send(body),
  };
};

async function supportTenant() {
  const t = await createTestTenant();
  await owner(t.id, async (tx) => {
    await seedHospitalStructure(tx, t.id);
    await seedClinicalMasters(tx, t.id);
    await seedSupportMasters(tx, t.id);
  });
  return t;
}

let seq = 0;
/** Pasien rawat inap Melati (DPJP = `dokter`) + order `orderableName`; bila kultur, order lab diterima unit Lab. */
async function ordered(orderableName: string, opts: { lab?: boolean } = {}) {
  const p = await createTestPatient(A.id, { name: `Pasien ${orderableName} Fiktif` });
  seq += 1;
  return run(A.id, async (tx) => {
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: A.id,
        number: `MP-RI-${String(Date.now() % 1e5).padStart(5, '0')}${seq}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: units.MELATI as string,
        plannedAt: new Date(),
      },
    });
    const pid = newId();
    await tx.encounterParticipant.create({
      data: {
        id: pid,
        tenantId: A.id,
        encounterId: enc.id,
        userId: users.dokter as string,
        role: 'dpjp_utama',
      },
    });
    await tx.accessRelationship.create({
      data: {
        id: newId(),
        tenantId: A.id,
        userId: users.dokter as string,
        patientId: p.id,
        kind: 'dpjp',
        validFrom: new Date(Date.now() - 60_000),
        sourceType: 'encounter_participant',
        sourceId: pid,
      },
    });
    const group = await tx.orderGroup.create({
      data: {
        id: newId(),
        tenantId: A.id,
        encounterId: enc.id,
        patientId: p.id,
        idempotencyKey: newId(),
        requestHash: 'a'.repeat(64),
        orderedBy: users.dokter as string,
        orderedRole: 'dokter',
      },
    });
    const orderable = await tx.orderable.findFirstOrThrow({ where: { name: orderableName } });
    const sr = await tx.serviceRequest.create({
      data: {
        id: newId(),
        tenantId: A.id,
        orderGroupId: group.id,
        encounterId: enc.id,
        patientId: p.id,
        orderableId: orderable.id,
        name: orderable.name,
        codeSystem: orderable.codeSystem,
        code: orderable.code,
        priority: 'rutin',
      },
    });
    let labOrderId: string | null = null;
    if (opts.lab) {
      const lo = await tx.labOrder.create({
        data: {
          id: newId(),
          tenantId: A.id,
          labNo: `L261008${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
          encounterId: enc.id,
          patientId: p.id,
          unitId: units.LAB as string,
          priority: 'rutin',
          status: 'proses',
          idempotencyKey: newId(),
          acceptedBy: users.analis as string,
        },
      });
      await tx.labOrderItem.create({
        data: { id: newId(), tenantId: A.id, labOrderId: lo.id, serviceRequestId: sr.id },
      });
      labOrderId = lo.id;
    }
    return { patientId: p.id, encounterId: enc.id, serviceRequestId: sr.id, labOrderId };
  });
}

beforeAll(async () => {
  app = await createTestApp();
  A = await supportTenant();
  B = await supportTenant();
  for (const code of ['MELATI', 'LAB', 'ANGGREK']) {
    units[code] = (await run(A.id, (tx) => tx.unit.findFirstOrThrow({ where: { code } }))).id;
  }
  for (const [who, t, role, unitCode] of [
    ['dokter', A, 'dokter', 'MELATI'],
    ['dokterLain', A, 'dokter', 'ANGGREK'],
    ['analis', A, 'analis_lab', 'LAB'],
    ['analis2', A, 'analis_lab', 'LAB'],
    ['spPk', A, 'dokter', 'LAB'],
    ['spPk2', A, 'dokter', 'LAB'],
    ['perawat', A, 'perawat', 'MELATI'],
    ['analisB', B, 'analis_lab', 'LAB'],
  ] as const) {
    const unitId = unitCode
      ? (await run(t.id, (tx) => tx.unit.findFirstOrThrow({ where: { code: unitCode } }))).id
      : undefined;
    const user = await createTestUser(t.id, { roles: [{ code: role, unitId }], tenantCode: t.code });
    users[who] = user.id;
    tok[who] = await login(app, user);
  }
});

afterAll(async () => {
  await app?.close();
});

const isolate = (labOrderId: string, stage: 'awal' | 'akhir', over: object = {}) => ({
  labOrderId,
  stage,
  organismCode: 'Escherichia coli',
  growth: stage === 'awal' ? 'Batang Gram negatif, tumbuh 24 jam' : '>10^5 CFU/mL',
  susceptibilities: [],
  ...over,
});

describe('mikrobiologi (S02)', () => {
  it('awal → akhir: validasi teknis analis, rilis klinis dokter lain ber-TTE, isolat terkunci per tahap, event', async () => {
    const o = await ordered('Kultur darah + uji kepekaan', { lab: true });
    const lo = o.labOrderId as string;
    const wl = (await as('analis').get('/micro/worklist').expect(200)).body;
    microWorklistSchema.parse(wl);
    expect(wl.view).toBe('layanan');
    const row = wl.orders.find((x: { labOrderId: string }) => x.labOrderId === lo);
    expect(row.tests.map((t: { code: string }) => t.code)).toEqual(['KULTUR-DARAH']);
    // Laporan awal tanpa uji kepekaan.
    await as('analis')
      .post(
        '/micro/isolates',
        isolate(lo, 'awal', {
          susceptibilities: [{ antibioticCode: 'Meropenem', result: 'S', micValue: null }],
        }),
      )
      .expect(400);
    await as('analis').post('/micro/isolates', isolate(lo, 'awal')).expect(201);
    // Laporan akhir sebelum awal dirilis ditolak trigger.
    const early = await as('analis')
      .post('/micro/reports', { labOrderId: lo, stage: 'akhir', conclusion: 'E. coli' })
      .expect(409);
    expect(early.body.code).toBe('MICRO_STAGE_ORDER');
    const t1 = (
      await as('analis')
        .post('/micro/reports', {
          labOrderId: lo,
          stage: 'awal',
          conclusion: 'Batang Gram negatif dari botol aerob',
        })
        .expect(201)
    ).body;
    microOrderRecordSchema.parse(t1);
    const closed = await as('analis2').post('/micro/isolates', isolate(lo, 'awal')).expect(409);
    expect(closed.body.code).toBe('MICRO_STAGE_CLOSED');
    // Analis tidak memegang rilis klinis.
    await as('analis').post(`/micro/reports/${t1.reports[0].id}/release`).expect(403);
    const r1 = (await as('spPk').post(`/micro/reports/${t1.reports[0].id}/release`).expect(201)).body;
    expect(r1.reports[0].clinicalBy.id).toBe(users.spPk);
    expect(r1.reports[0].documentId).toBeTruthy();
    await as('spPk2').post(`/micro/reports/${t1.reports[0].id}/release`).expect(409);
    // Laporan akhir dengan S/I/R + MIC.
    await as('analis')
      .post(
        '/micro/isolates',
        isolate(lo, 'akhir', {
          susceptibilities: [
            { antibioticCode: 'Seftriakson', result: 'R', micValue: 64 },
            { antibioticCode: 'Meropenem', result: 'S', micValue: 0.25 },
            { antibioticCode: 'Siprofloksasin', result: 'I', micValue: 1 },
          ],
        }),
      )
      .expect(201);
    const t2 = (
      await as('analis2')
        .post('/micro/reports', {
          labOrderId: lo,
          stage: 'akhir',
          conclusion: 'E. coli ESBL; sensitif meropenem',
        })
        .expect(201)
    ).body;
    const akhir = t2.reports.find((r: { stage: string }) => r.stage === 'akhir');
    await as('spPk2').post(`/micro/reports/${akhir.id}/release`).expect(201);
    const ev = await run(A.id, (tx) =>
      tx.domainEvent.findFirst({ where: { name: 'micro.report_released' }, orderBy: { occurredAt: 'desc' } }),
    );
    expect(ev?.payload).toMatchObject({ labOrderId: lo, stage: 'akhir' });
    // Laporan dirilis tidak bisa diubah/dihapus, termasuk oleh pemilik tabel.
    await expect(
      owner(A.id, (tx) => tx.microReport.update({ where: { id: akhir.id }, data: { conclusion: 'diubah' } })),
    ).rejects.toThrow(/APPEND_ONLY/);
    // Validator teknis tidak boleh merilis laporannya sendiri (trigger).
    const o2 = await ordered('Kultur urin + uji kepekaan', { lab: true });
    const own = (
      await as('analis')
        .post('/micro/reports', {
          labOrderId: o2.labOrderId,
          stage: 'awal',
          conclusion: 'Tidak ada pertumbuhan',
        })
        .expect(201)
    ).body;
    await expect(
      owner(A.id, (tx) =>
        tx.microReport.update({
          where: { id: own.reports[0].id },
          data: { clinicalBy: users.analis as string, clinicalAt: new Date() },
        }),
      ),
    ).rejects.toThrow(/VALIDATOR_SAME_USER|micro_reports_values_valid/);

    const today = new Date().toISOString().slice(0, 10);
    const ab = (await as('analis').get(`/micro/antibiogram?from=${today}&to=${today}`).expect(200)).body;
    antibiogramSchema.parse(ab);
    const ecoli = ab.rows.find((x: { organismCode: string }) => x.organismCode === 'Escherichia coli');
    expect(ecoli.isolates).toBeGreaterThanOrEqual(1);
    expect(
      ecoli.antibiotics.find((a: { antibioticCode: string }) => a.antibioticCode === 'Meropenem'),
    ).toMatchObject({
      susceptible: 1,
      percentSusceptible: 100,
    });
  });

  it('izin dan isolasi: perawat tanpa izin lab (403); dokter ruangan tanpa relasi tidak melihat; tenant lain 404', async () => {
    const o = await ordered('Kultur sputum + uji kepekaan', { lab: true });
    await as('perawat')
      .post('/micro/isolates', isolate(o.labOrderId as string, 'awal'))
      .expect(403);
    const dpjp = (await as('dokter').get('/micro/worklist').expect(200)).body;
    expect(dpjp.view).toBe('ruangan');
    expect(dpjp.orders.map((x: { labOrderId: string }) => x.labOrderId)).toContain(o.labOrderId);
    const other = (await as('dokterLain').get('/micro/worklist').expect(200)).body;
    expect(other.orders.map((x: { labOrderId: string }) => x.labOrderId)).not.toContain(o.labOrderId);
    await as('dokterLain').get(`/micro/orders/${o.labOrderId}`).expect(403);
    await as('analisB').get(`/micro/orders/${o.labOrderId}`).expect(404);
  });
});

describe('patologi anatomi (S02)', () => {
  it('laporan berversi: koreksi sebelum TTE, TTE mengunci versi, addendum sesudahnya, event pa.report_signed', async () => {
    const o = await ordered('EKG 12 sadapan');
    const body = {
      encounterId: o.encounterId,
      surgeryCaseId: null,
      surgerySpecimenId: null,
      specimenSite: 'Kandung empedu',
      macroscopic: 'Kandung empedu 8 x 3 cm, dinding menebal 4 mm, batu multipel',
      microscopic: 'Mukosa dengan infiltrat limfosit, sinus Rokitansky-Aschoff',
      diagnosis: 'Kolesistitis kronik kalkulosa',
      icd10: 'K80.1',
      imageDocumentIds: [],
      occurredAt: new Date().toISOString(),
      revision: { kind: 'baru' },
    };
    await as('analis').post('/pa/reports', body).expect(403);
    const v1 = (await as('spPk').post('/pa/reports', body).expect(201)).body;
    paReportRecordSchema.parse(v1);
    const v2 = (
      await as('spPk')
        .post('/pa/reports', {
          ...body,
          diagnosis: 'Kolesistitis kronik kalkulosa, tanpa displasia',
          revision: {
            kind: 'koreksi',
            supersedesId: v1.meta.id,
            correctionReason: 'Menambahkan status displasia',
          },
        })
        .expect(201)
    ).body;
    expect(v2.meta.version).toBe(2);
    await as('spPk').post(`/pa/reports/${v1.meta.id}/sign`).expect(409);
    const signed = (await as('spPk').post(`/pa/reports/${v2.meta.id}/sign`).expect(201)).body;
    expect(signed.documentId).toBeTruthy();
    const locked = await as('spPk')
      .post('/pa/reports', {
        ...body,
        revision: {
          kind: 'koreksi',
          supersedesId: v2.meta.id,
          correctionReason: 'Koreksi setelah TTE tidak boleh',
        },
      })
      .expect(409);
    expect(locked.body.code).toBe('RECORD_LOCKED');
    await as('spPk')
      .post('/pa/reports', {
        ...body,
        diagnosis: 'Addendum: imunohistokimia menyusul',
        revision: { kind: 'addendum', addendumOf: v2.meta.id },
      })
      .expect(201);
    const ev = await run(A.id, (tx) =>
      tx.domainEvent.findFirst({ where: { name: 'pa.report_signed' }, orderBy: { occurredAt: 'desc' } }),
    );
    expect(ev?.payload).toMatchObject({ paReportId: v2.meta.id, encounterId: o.encounterId });
    // Spesimen OK yang tidak ada / bukan milik kunjungan ditolak.
    await as('spPk')
      .post('/pa/reports', { ...body, surgerySpecimenId: newId() })
      .expect(422);
    const wl = (await as('spPk').get('/pa/worklist').expect(200)).body;
    expect(wl.view).toBe('layanan');
  });
});

describe('diagnostik lain (S10)', () => {
  it('order EKG → isian P07 → laporan → TTE → event + tampil di panel hasil fase 3', async () => {
    const o = await ordered('EKG 12 sadapan');
    const wl = (await as('spPk').get('/diagnostics/worklist').expect(200)).body;
    diagnosticWorklistSchema.parse(wl);
    const item = wl.items.find(
      (x: { serviceRequestId: string }) => x.serviceRequestId === o.serviceRequestId,
    );
    expect(item).toMatchObject({ kind: 'ekg', report: null });
    await as('spPk')
      .post(`/diagnostics/requests/${o.serviceRequestId}/form`, { answers: { irama: 'sinus' } })
      .expect(400);
    const form = (
      await as('spPk')
        .post(`/diagnostics/requests/${o.serviceRequestId}/form`, {
          answers: { irama: 'sinus', laju: 78, temuan: 'Aksis normal, PR 160 ms, tanpa perubahan ST-T' },
        })
        .expect(201)
    ).body;
    const report = {
      serviceRequestId: o.serviceRequestId,
      kind: 'ekg',
      formResponseId: form.formResponseId,
      documentIds: [],
      conclusion: 'EKG dalam batas normal',
      occurredAt: new Date().toISOString(),
    };
    await as('spPk')
      .post('/diagnostics/reports', { ...report, kind: 'echo' })
      .expect(422);
    await as('perawat').post('/diagnostics/reports', report).expect(403);
    const created = (await as('spPk').post('/diagnostics/reports', report).expect(201)).body;
    expect(created).toMatchObject({ kind: 'ekg', documentId: null });
    await as('spPk').post('/diagnostics/reports', report).expect(409);
    const signed = (await as('spPk').post(`/diagnostics/reports/${created.meta.id}/sign`).expect(201)).body;
    expect(signed.documentId).toBeTruthy();
    await as('spPk').post(`/diagnostics/reports/${created.meta.id}/sign`).expect(409);
    const ev = await run(A.id, (tx) =>
      tx.domainEvent.findFirst({
        where: { name: 'diagnostic.report_signed' },
        orderBy: { occurredAt: 'desc' },
      }),
    );
    expect(ev?.payload).toMatchObject({ diagnosticReportId: created.meta.id, kind: 'ekg' });
    const results = (await as('dokter').get(`/results?patientId=${o.patientId}`).expect(200)).body;
    expect(results.reports.map((r: { id?: string; meta?: { id: string } }) => r.meta?.id ?? r.id)).toContain(
      created.meta.id,
    );
    // Dokter ruangan tanpa relasi tidak bisa membuat laporan untuk pasien ini.
    await as('dokterLain')
      .post(`/diagnostics/requests/${o.serviceRequestId}/form`, { answers: {} })
      .expect(403);
  });
});
