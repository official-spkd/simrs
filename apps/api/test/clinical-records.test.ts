/**
 * Fase 3 · potongan 3.2a · data klinis terkode (K08), tanda vital + NEWS2 + eskalasi (K12), hasil penunjang, banner
 * kunjungan, dan ringkasan pasien (K14): izin per peran, ABAC unit tingkat bed, tenant lain 404, entri berversi
 * (koreksi/salah entri), satu diagnosis utama per kunjungan (juga serentak), NKDA eksplisit, kode hanya dari data
 * rujukan, staging SATUSEHAT `held` + biaya tindakan, audit per pasien. Data fiktif.
 */
import {
  createPrismaClient,
  seedClinicalMasters,
  seedHospitalStructure,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
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

const run = <R>(tenantId: string, fn: (tx: TenantTx) => Promise<R>) => withTenant(testDb(), tenantId, fn);
const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}) => http().post(`/api/v1${url}`).set(auth()).send(body),
  };
};

async function clinicalTenant() {
  const t = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, t.id, async (tx) => {
      await seedHospitalStructure(tx, t.id);
      await seedClinicalMasters(tx, t.id);
    });
  } finally {
    await owner.$disconnect();
  }
  return t;
}

let seq = 0;
/** Pasien rawat inap aktif di bed kosong unit `unitCode`. */
async function inpatient(tenantId: string, unitCode = 'MELATI', name = 'Pasien Rekam Klinis Fiktif') {
  const p = await createTestPatient(tenantId, { name, birthDate: '1960-07-15' });
  seq += 1;
  return run(tenantId, async (tx) => {
    const u = (await tx.unit.findFirstOrThrow({ where: { code: unitCode } })).id;
    const occupied = (
      await tx.bedAssignment.findMany({ where: { endedAt: null }, select: { locationId: true } })
    ).map((a) => a.locationId);
    const bed = await tx.location.findFirstOrThrow({
      where: { kind: 'bed', unitId: u, id: { notIn: occupied } },
      orderBy: { code: 'asc' },
    });
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId,
        number: `RI-2610-${String(Date.now() % 1e5).padStart(5, '0')}${seq}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: u,
        plannedAt: new Date(),
      },
    });
    await tx.bedAssignment.create({
      data: {
        id: newId(),
        tenantId,
        encounterId: enc.id,
        patientId: p.id,
        locationId: bed.id,
        startedAt: new Date(),
      },
    });
    return { patientId: p.id, encounterId: enc.id, bed };
  });
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const baru = { kind: 'baru' } as const;

const condition = (encounterId: string, over: object = {}) => ({
  encounterId,
  kind: 'encounter',
  role: 'utama',
  code: 'J18.9',
  clinicalStatus: 'active',
  note: null,
  occurredAt: minutesAgo(5),
  revision: baru,
  ...over,
});

/** NEWS2 13: napas 26 (3), SpO2 90 (3), oksigen (2), sistolik 95 (2), nadi 120 (2), sadar (0), suhu 38,5 (1). */
const highVitals = (encounterId: string) => ({
  encounterId,
  occurredAt: minutesAgo(2),
  temp: 38.5,
  hr: 120,
  rr: 26,
  sbp: 95,
  dbp: 60,
  spo2: 90,
  onOxygen: true,
  consciousness: 'A',
  weightKg: 62,
});
const normalVitals = (encounterId: string) => ({
  ...highVitals(encounterId),
  temp: 36.8,
  hr: 80,
  rr: 16,
  sbp: 120,
  dbp: 80,
  spo2: 98,
  onOxygen: false,
});

beforeAll(async () => {
  app = await createTestApp();
  A = await clinicalTenant();
  B = await clinicalTenant();
  for (const [who, t, role, unitCode] of [
    ['dokter', A, 'dokter', 'MELATI'],
    ['dokter2', A, 'dokter', 'MELATI'],
    ['residen', A, 'dokter_residen', 'MELATI'],
    ['perawat', A, 'perawat', 'MELATI'],
    ['perawatAnggrek', A, 'perawat', 'ANGGREK'],
    ['analis', A, 'analis_lab', undefined],
    ['kasir', A, 'kasir', undefined],
    ['dokterB', B, 'dokter', 'MELATI'],
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

describe('tanda vital + NEWS2 (K12)', () => {
  it('skor dihitung server; eskalasi → notifikasi tanpa PHI ke tim perawatan; skor dari klien ditolak', async () => {
    const e = await inpatient(A.id, 'MELATI', 'Sulastri Vital Fiktif');
    await run(A.id, (tx) =>
      tx.encounterParticipant.create({
        data: {
          id: newId(),
          tenantId: A.id,
          encounterId: e.encounterId,
          userId: users.dokter as string,
          role: 'dpjp_utama',
        },
      }),
    );
    const url = `/encounters/${e.encounterId}/observations`;
    const low = await as('perawat').post(url, normalVitals(e.encounterId)).expect(201);
    expect(low.body).toMatchObject({
      version: 1,
      ews: { score: 0, maxParam: 0, risk: 'rendah' },
      author: { userId: users.perawat, peran: 'perawat' },
    });
    const notes = () =>
      run(A.id, (tx) =>
        tx.notification.findMany({ where: { recipientUserId: users.dokter, kind: 'ews_escalation' } }),
      );
    expect(await notes()).toHaveLength(0);

    const high = await as('perawat').post(url, highVitals(e.encounterId)).expect(201);
    expect(high.body.ews).toEqual({ score: 13, maxParam: 3, risk: 'tinggi', escalated: true });
    const sent = await notes();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.link).toBe(`/klinis/rawat-inap?kunjungan=${e.encounterId}`);
    expect(JSON.stringify(sent)).not.toContain('Sulastri');
    const row = await run(A.id, (tx) => tx.observation.findUniqueOrThrow({ where: { id: high.body.id } }));
    expect(row).toMatchObject({ category: 'vital', ewsScore: 13, ewsMaxParam: 3, interpretation: 'kritis' });
    // Staging SATUSEHAT `held` per versi.
    const held = await run(A.id, (tx) =>
      tx.outboxMessage.findFirst({
        where: { idempotencyKey: `satusehat.observation.upsert:${high.body.id}:1` },
      }),
    );
    expect(held?.status).toBe('held');

    await as('perawat')
      .post(url, { ...normalVitals(e.encounterId), ewsScore: 0 })
      .expect(400);
    await as('perawat').post(`/encounters/${newId()}/observations`, normalVitals(e.encounterId)).expect(422);

    const list = await as('dokter').get(url).expect(200);
    expect(list.body.map((v: { id: string }) => v.id)).toEqual([high.body.id, low.body.id]);

    // Salah entri oleh pencatat; versi terkini tidak lagi tampil.
    await as('perawat')
      .post(`${url}/${low.body.id}/entered-in-error`, { reason: 'Tercatat untuk pasien lain' })
      .expect(201);
    const after = await as('dokter').get(url).expect(200);
    expect(after.body.map((v: { id: string }) => v.id)).toEqual([high.body.id]);
    await as('kasir').get(url).expect(403);
  });

  it('ABAC: perawat unit lain 403 + audit; tenant lain 404', async () => {
    const e = await inpatient(A.id, 'MELATI');
    const url = `/encounters/${e.encounterId}/observations`;
    const denied = await as('perawatAnggrek').post(url, normalVitals(e.encounterId));
    expect(denied.status).toBe(403);
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.count({
        where: { action: 'access_denied', patientId: e.patientId, actorUserId: users.perawatAnggrek },
      }),
    );
    expect(audit).toBeGreaterThanOrEqual(1);
    await as('dokterB').get(url).expect(404);
    await as('dokterB').get(`/encounters/${e.encounterId}/context`).expect(404);
  });
});

describe('diagnosis (K08)', () => {
  it('ICD-10 dari data rujukan; satu diagnosis utama; koreksi berversi; salah entri; staging', async () => {
    const e = await inpatient(A.id);
    const v1 = await as('dokter').post('/diagnosis/conditions', condition(e.encounterId)).expect(201);
    expect(v1.body).toMatchObject({
      version: 1,
      role: 'utama',
      code: 'J18.9',
      display: 'Pneumonia, tidak spesifik',
      author: { userId: users.dokter, peran: 'dokter' },
    });
    // Nama dari body tidak diterima; kode tak dikenal di data rujukan → 422.
    await as('dokter')
      .post('/diagnosis/conditions', { ...condition(e.encounterId), display: 'Karangan' })
      .expect(400);
    const unknown = await as('dokter').post(
      '/diagnosis/conditions',
      condition(e.encounterId, { role: 'sekunder', code: 'Z99.9' }),
    );
    expect(unknown.status).toBe(422);

    const second = await as('dokter2').post(
      '/diagnosis/conditions',
      condition(e.encounterId, { code: 'A41.9' }),
    );
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      code: 'PRIMARY_DIAGNOSIS_EXISTS',
      details: { existingId: v1.body.id },
    });
    await as('residen')
      .post('/diagnosis/conditions', condition(e.encounterId, { role: 'sekunder', code: 'E11.9' }))
      .expect(201);

    // Koreksi diagnosis utama oleh penulisnya: versi 2 di rantai yang sama (tetap satu utama).
    const v2 = await as('dokter')
      .post(
        '/diagnosis/conditions',
        condition(e.encounterId, {
          code: 'J13',
          revision: {
            kind: 'koreksi',
            supersedesId: v1.body.id,
            correctionReason: 'Kultur sputum S. pneumoniae',
          },
        }),
      )
      .expect(201);
    expect(v2.body).toMatchObject({ version: 2, rootId: v1.body.id, supersedesId: v1.body.id, code: 'J13' });
    const list = await as('perawat').get(`/encounters/${e.encounterId}/conditions`).expect(200);
    expect(list.body.map((c: { code: string; role: string }) => [c.code, c.role])).toEqual([
      ['J13', 'utama'],
      ['E11.9', 'sekunder'],
    ]);
    const versions = await run(A.id, (tx) =>
      tx.condition.findMany({ where: { rootId: v1.body.id }, orderBy: { version: 'asc' } }),
    );
    expect(versions.map((v) => [v.version, v.code])).toEqual([
      [1, 'J18.9'],
      [2, 'J13'],
    ]);
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findFirst({ where: { resourceType: 'condition', resourceId: v2.body.id } }),
    );
    expect(audit).toMatchObject({ action: 'correct', patientId: e.patientId });
    expect(JSON.stringify(audit?.details)).not.toContain('J13');

    // Salah entri diagnosis utama → kunjungan boleh punya diagnosis utama baru.
    await as('dokter')
      .post(`/diagnosis/conditions/${v2.body.id}/entered-in-error`, { reason: 'Pasien tertukar saat input' })
      .expect(201);
    await as('dokter2')
      .post('/diagnosis/conditions', condition(e.encounterId, { code: 'A41.9' }))
      .expect(201);
    const held = await run(A.id, (tx) =>
      tx.outboxMessage.count({
        where: {
          operation: 'satusehat.condition.upsert',
          status: 'held',
          payload: { path: ['sourceId'], equals: v1.body.id },
        },
      }),
    );
    expect(held).toBe(1);
  });

  it('dua diagnosis utama serentak → [201, 409]', async () => {
    const e = await inpatient(A.id);
    const results = await Promise.all([
      as('dokter').post('/diagnosis/conditions', condition(e.encounterId, { code: 'I10' })),
      as('dokter2').post('/diagnosis/conditions', condition(e.encounterId, { code: 'E11.9' })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe('PRIMARY_DIAGNOSIS_EXISTS');
  });

  it('izin per peran: kasir 403, analis lab tidak menulis diagnosis; problem list lintas kunjungan', async () => {
    const e = await inpatient(A.id);
    await as('kasir').post('/diagnosis/conditions', condition(e.encounterId)).expect(403);
    await as('analis').post('/diagnosis/conditions', condition(e.encounterId)).expect(403);
    const problem = await as('dokter')
      .post(
        '/diagnosis/conditions',
        condition(e.encounterId, { kind: 'problem_list', role: null, code: 'I10' }),
      )
      .expect(201);
    expect(problem.body).toMatchObject({ kind: 'problem_list', role: null });
    await as('dokter')
      .post('/diagnosis/conditions', condition(e.encounterId, { kind: 'problem_list', role: 'utama' }))
      .expect(400);
    const pl = await as('dokter').get(`/diagnosis/problem-list?patientId=${e.patientId}`).expect(200);
    expect(pl.body.map((c: { id: string }) => c.id)).toEqual([problem.body.id]);
  });
});

describe('prosedur (K08)', () => {
  it('ICD-9-CM; biaya tindakan sekali per rantai walau dikoreksi', async () => {
    const e = await inpatient(A.id);
    const p1 = await as('dokter')
      .post('/diagnosis/procedures', {
        encounterId: e.encounterId,
        code: '89.52',
        note: null,
        occurredAt: minutesAgo(10),
        revision: baru,
      })
      .expect(201);
    expect(p1.body).toMatchObject({ code: '89.52', display: 'EKG' });
    await as('dokter')
      .post('/diagnosis/procedures', {
        encounterId: e.encounterId,
        code: '88.72',
        note: 'Koreksi: ekokardiografi',
        occurredAt: minutesAgo(10),
        revision: {
          kind: 'koreksi',
          supersedesId: p1.body.id,
          correctionReason: 'Tindakan yang dilakukan ekokardiografi',
        },
      })
      .expect(201);
    const billable = await run(A.id, (tx) =>
      tx.billableEvent.findMany({ where: { sourceType: 'procedures', sourceId: p1.body.id } }),
    );
    expect(billable).toHaveLength(1);
    expect(billable[0]).toMatchObject({ kind: 'tindakan', encounterId: e.encounterId });
    const list = await as('dokter').get(`/encounters/${e.encounterId}/procedures`).expect(200);
    expect(list.body.map((p: { code: string }) => p.code)).toEqual(['88.72']);
    // Koreksi oleh dokter lain: hanya penulis asli.
    const other = await as('dokter2').post('/diagnosis/procedures', {
      encounterId: e.encounterId,
      code: '89.03',
      note: null,
      occurredAt: minutesAgo(10),
      revision: {
        kind: 'koreksi',
        supersedesId: list.body[0].id,
        correctionReason: 'Bukan penulis entri ini',
      },
    });
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('RECORD_NOT_AUTHOR');
  });
});

describe('alergi + NKDA (K08)', () => {
  it('belum dikaji ≠ NKDA; NKDA eksklusif; satu entri per zat; perubahan = versi baru', async () => {
    const e = await inpatient(A.id);
    const amox = (
      await run(A.id, (tx) => tx.drugSubstance.findFirstOrThrow({ where: { code: 'amoksisilin' } }))
    ).id;
    const url = `/diagnosis/allergies?patientId=${e.patientId}`;
    expect((await as('perawat').get(url).expect(200)).body).toMatchObject({ status: 'belum_dikaji' });
    const base = {
      patientId: e.patientId,
      encounterId: e.encounterId,
      occurredAt: minutesAgo(3),
      revision: baru,
    };
    const nkda = await as('perawat')
      .post('/diagnosis/allergies', {
        ...base,
        kind: 'nkda',
        substanceId: null,
        text: null,
        category: null,
        criticality: null,
        reaction: null,
      })
      .expect(201);
    expect((await as('perawat').get(url).expect(200)).body).toMatchObject({
      status: 'nkda',
      nkda: { id: nkda.body.id },
    });
    const allergy = {
      ...base,
      kind: 'alergi',
      substanceId: amox,
      text: null,
      category: 'obat',
      criticality: 'tinggi',
      reaction: 'Urtikaria',
    };
    const blocked = await as('dokter').post('/diagnosis/allergies', allergy);
    expect(blocked.status).toBe(409);
    expect(blocked.body.details).toMatchObject({ rule: 'nkda_exclusive' });
    // NKDA bisa digantikan versi baru oleh pencatatnya: koreksi NKDA → alergi.
    const v2 = await as('perawat')
      .post('/diagnosis/allergies', {
        ...allergy,
        revision: {
          kind: 'koreksi',
          supersedesId: nkda.body.id,
          correctionReason: 'Keluarga melaporkan alergi amoksisilin',
        },
      })
      .expect(201);
    expect(v2.body).toMatchObject({ kind: 'alergi', version: 2, substance: { code: 'amoksisilin' } });
    const dup = await as('dokter').post('/diagnosis/allergies', { ...allergy, criticality: 'rendah' });
    expect(dup.status).toBe(409);
    expect(dup.body.details).toMatchObject({ rule: 'one_entry_per_substance' });
    const nkdaAgain = await as('dokter').post('/diagnosis/allergies', {
      ...base,
      kind: 'nkda',
      substanceId: null,
      text: null,
      category: null,
      criticality: null,
      reaction: null,
    });
    expect(nkdaAgain.status).toBe(409);
    await as('dokter')
      .post('/diagnosis/allergies', { ...allergy, substanceId: null, text: 'Udang', category: 'makanan' })
      .expect(201);
    const now = (await as('dokter').get(url).expect(200)).body;
    expect(now.status).toBe('ada');
    expect(now.allergies).toHaveLength(2);
  });
});

describe('hasil penunjang (K08)', () => {
  it('analis lab menulis laporan + hasil (LOINC dari data rujukan); dokter/perawat membaca; dokter tidak menulis', async () => {
    const e = await inpatient(A.id);
    const report = await as('analis')
      .post('/results/reports', {
        encounterId: e.encounterId,
        occurredAt: minutesAgo(30),
        category: 'lab',
        code: null,
        display: 'Kimia darah',
        conclusion: null,
        revision: baru,
        observations: [
          {
            category: 'lab',
            code: '2160-0',
            display: null,
            valueNumeric: 1.9,
            valueUnit: 'mg/dL',
            valueText: null,
            interpretation: 'tinggi',
            referenceRange: '0,6–1,2',
          },
          {
            category: 'lab',
            code: '718-7',
            display: null,
            valueNumeric: 12.4,
            valueUnit: 'g/dL',
            valueText: null,
            interpretation: 'normal',
            referenceRange: '12–16',
          },
        ],
      })
      .expect(201);
    expect(
      report.body.observations.map((o: { display: string; valueNumeric: number }) => [
        o.display,
        o.valueNumeric,
      ]),
    ).toEqual([
      ['Kreatinin', 1.9],
      ['Hemoglobin', 12.4],
    ]);
    const unknown = await as('analis').post('/results/observations', {
      encounterId: e.encounterId,
      occurredAt: minutesAgo(5),
      category: 'lab',
      code: '9999-9',
      display: null,
      valueNumeric: 1,
      valueUnit: null,
      valueText: null,
      interpretation: null,
      referenceRange: null,
      diagnosticReportId: null,
      revision: baru,
    });
    expect(unknown.status).toBe(422);
    const crp = await as('analis')
      .post('/results/observations', {
        encounterId: e.encounterId,
        occurredAt: minutesAgo(5),
        category: 'lab',
        code: '1988-5',
        display: null,
        valueNumeric: 48,
        valueUnit: 'mg/L',
        valueText: null,
        interpretation: 'tinggi',
        referenceRange: '< 5',
        diagnosticReportId: null,
        revision: baru,
      })
      .expect(201);
    // Koreksi kreatinin oleh analis yang sama: versi baru, tetap di laporan.
    const creat = report.body.observations[0];
    await as('analis')
      .post('/results/observations', {
        encounterId: e.encounterId,
        occurredAt: minutesAgo(30),
        category: 'lab',
        code: '2160-0',
        display: null,
        valueNumeric: 1.6,
        valueUnit: 'mg/dL',
        valueText: null,
        interpretation: 'tinggi',
        referenceRange: '0,6–1,2',
        diagnosticReportId: report.body.id,
        revision: {
          kind: 'koreksi',
          supersedesId: creat.id,
          correctionReason: 'Salah ketik nilai kreatinin',
        },
      })
      .expect(201);
    const read = await as('dokter').get(`/results?patientId=${e.patientId}`).expect(200);
    expect(read.body.reports).toHaveLength(1);
    expect(
      read.body.reports[0].observations.map((o: { valueNumeric: number }) => o.valueNumeric).sort(),
    ).toEqual([1.6, 12.4]);
    expect(read.body.observations.map((o: { id: string }) => o.id)).toEqual([crp.body.id]);
    await as('perawat').get(`/results?patientId=${e.patientId}`).expect(200);
    await as('kasir').get(`/results?patientId=${e.patientId}`).expect(403);
    await as('dokter')
      .post('/results/observations', {
        encounterId: e.encounterId,
        occurredAt: minutesAgo(5),
        category: 'lab',
        code: '1988-5',
        display: null,
        valueNumeric: 1,
        valueUnit: null,
        valueText: null,
        interpretation: null,
        referenceRange: null,
        diagnosticReportId: null,
        revision: baru,
      })
      .expect(403);
    await as('perawatAnggrek').get(`/results?patientId=${e.patientId}`).expect(403);
  });
});

describe('banner kunjungan dan ringkasan pasien (K14)', () => {
  it('konteks kunjungan memuat alergi, diagnosis utama, EWS terakhir, bed; ringkasan lintas kunjungan; audit per pasien', async () => {
    const e = await inpatient(A.id, 'MELATI', 'Hartono Banner Fiktif');
    await as('dokter')
      .post('/diagnosis/conditions', condition(e.encounterId, { code: 'I21.4' }))
      .expect(201);
    await as('dokter')
      .post(
        '/diagnosis/conditions',
        condition(e.encounterId, { kind: 'problem_list', role: null, code: 'I10' }),
      )
      .expect(201);
    await as('perawat')
      .post('/diagnosis/allergies', {
        patientId: e.patientId,
        encounterId: e.encounterId,
        kind: 'alergi',
        substanceId: null,
        text: 'Kacang',
        category: 'makanan',
        criticality: 'rendah',
        reaction: null,
        occurredAt: minutesAgo(3),
        revision: baru,
      })
      .expect(201);
    await as('perawat')
      .post(`/encounters/${e.encounterId}/observations`, highVitals(e.encounterId))
      .expect(201);

    const ctx = await as('perawat').get(`/encounters/${e.encounterId}/context`).expect(200);
    expect(ctx.body).toMatchObject({
      patient: {
        id: e.patientId,
        name: 'Hartono Banner Fiktif',
        birthDate: '1960-07-15',
        confidential: false,
      },
      encounter: { id: e.encounterId, class: 'IMP', bed: { id: e.bed.id, code: e.bed.code } },
      allergy: { status: 'ada', labels: ['Kacang · rendah'] },
      primaryDiagnosis: { code: 'I21.4', display: 'Infark miokard akut non-ST elevasi' },
      latestEws: { score: 13, risk: 'tinggi' },
    });
    expect(ctx.body.patient.ageYears).toBeGreaterThanOrEqual(65);

    const sum = await as('dokter').get(`/summary/patients/${e.patientId}`).expect(200);
    expect(sum.body.activeProblems.map((c: { code: string }) => c.code)).toEqual(['I10']);
    expect(sum.body.encounters[0]).toMatchObject({
      id: e.encounterId,
      primaryDiagnosis: { code: 'I21.4' },
    });
    expect(sum.body.latestVitals.ews).toMatchObject({ score: 13, risk: 'tinggi' });
    expect(sum.body.allergies.status).toBe('ada');

    const reads = await run(A.id, (tx) =>
      tx.auditEvent.findMany({
        where: {
          action: 'read',
          patientId: e.patientId,
          resourceType: { in: ['encounter_context', 'patient_summary'] },
        },
      }),
    );
    expect(reads.map((r) => r.resourceType).sort()).toEqual(['encounter_context', 'patient_summary']);
    await as('kasir').get(`/summary/patients/${e.patientId}`).expect(403);
    await as('perawatAnggrek').get(`/summary/patients/${e.patientId}`).expect(403);
    await as('dokterB').get(`/summary/patients/${e.patientId}`).expect(404);
  });
});
