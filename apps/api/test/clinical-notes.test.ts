/**
 * Fase 3 · potongan 3.2b · CPPT multi-PPA (K07), co-sign residen, verifikasi DPJP, serah terima SBAR, asesmen per
 * kunjungan (K06, formulir P07 + `encounterId`), dan worklist (K01): residen tidak memfinalkan sendiri, co-sign serentak
 * sekali, koreksi hanya penulis, addendum atas final, izin unit + isolasi tenant, singkatan terlarang = peringatan,
 * biaya visite DPJP. Data fiktif.
 */
import {
  createPrismaClient,
  ensurePublishedForm,
  seedClinicalMasters,
  seedHospitalStructure,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { MORSE_FALL_SCALE, newId } from '@simrs/shared';
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
      await ensurePublishedForm(tx, t.id, MORSE_FALL_SCALE);
    });
  } finally {
    await owner.$disconnect();
  }
  return t;
}

let seq = 0;
/** Pasien rawat inap aktif di bed kosong Melati; tim perawatan: dokter = DPJP utama, perawat = perawat PJ. */
async function inpatient(
  team: Array<[string, string]> = [
    ['dokter', 'dpjp_utama'],
    ['perawat', 'perawat_pj'],
  ],
) {
  const p = await createTestPatient(A.id, { name: 'Pasien CPPT Fiktif' });
  seq += 1;
  return run(A.id, async (tx) => {
    const u = (await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } })).id;
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
        tenantId: A.id,
        number: `RI-2610-${String(Date.now() % 1e5).padStart(5, '0')}${seq}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: u,
        plannedAt: new Date(),
      },
    });
    await tx.bedAssignment.create({
      data: { id: newId(), tenantId: A.id, encounterId: enc.id, patientId: p.id, locationId: bed.id },
    });
    for (const [who, role] of team) {
      const pid = newId();
      await tx.encounterParticipant.create({
        data: { id: pid, tenantId: A.id, encounterId: enc.id, userId: users[who] as string, role },
      });
      await tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: A.id,
          userId: users[who] as string,
          patientId: p.id,
          kind: role === 'perawat_pj' ? 'perawat_penanggung_jawab' : role === 'dpjp_utama' ? 'dpjp' : role,
          validFrom: new Date(Date.now() - 60_000),
          sourceType: 'encounter_participant',
          sourceId: pid,
        },
      });
    }
    return { patientId: p.id, encounterId: enc.id };
  });
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const soap = (encounterId: string, over: object = {}) => ({
  encounterId,
  occurredAt: hoursAgo(0.05),
  content: {
    format: 'soap',
    s: 'Sesak berkurang',
    o: 'SpO2 96%',
    a: 'Pneumonia membaik',
    p: 'Lanjut terapi',
  },
  instruction: null,
  revision: { kind: 'baru' },
  ...over,
});

beforeAll(async () => {
  app = await createTestApp();
  A = await clinicalTenant();
  B = await clinicalTenant();
  for (const [who, t, role, unitCode] of [
    ['dokter', A, 'dokter', 'MELATI'],
    ['dokter2', A, 'dokter', 'MELATI'],
    ['dokterLuar', A, 'dokter', undefined],
    ['residen', A, 'dokter_residen', 'MELATI'],
    ['perawat', A, 'perawat', 'MELATI'],
    ['perawatAnggrek', A, 'perawat', 'ANGGREK'],
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

describe('CPPT + co-sign residen (K07)', () => {
  it('residen → menunggu_cosign; residen/perawat tidak bisa co-sign; DPJP co-sign → final; co-sign catatan sendiri ditolak', async () => {
    const e = await inpatient();
    const r = await as('residen').post('/cppt/entries', soap(e.encounterId)).expect(201);
    expect(r.body).toMatchObject({
      ppa: 'residen',
      status: 'menunggu_cosign',
      cosignRequired: true,
      cosign: null,
      author: { userId: users.residen, peran: 'dokter_residen' },
    });
    // PPA/penulis dari sesi, bukan body.
    await as('residen')
      .post('/cppt/entries', { ...soap(e.encounterId), ppa: 'dpjp' })
      .expect(400);
    await as('residen').post(`/cppt/entries/${r.body.id}/cosign`, { note: null }).expect(403);
    await as('perawat').post(`/cppt/entries/${r.body.id}/cosign`, { note: null }).expect(403);
    // Dokter lain di unit yang sama tetapi bukan tim perawatan: lingkup co-sign `relationship` → 403.
    await as('dokter2').post(`/cppt/entries/${r.body.id}/cosign`, { note: null }).expect(403);

    const signed = await as('dokter')
      .post(`/cppt/entries/${r.body.id}/cosign`, { note: 'Setuju rencana' })
      .expect(201);
    expect(signed.body).toMatchObject({
      status: 'final',
      cosign: { kind: 'cosign', by: { userId: users.dokter, peran: 'dokter' } },
    });
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findFirst({ where: { action: 'cosign', resourceId: r.body.id } }),
    );
    expect(audit?.patientId).toBe(e.patientId);

    const own = await as('dokter').post('/cppt/entries', soap(e.encounterId)).expect(201);
    expect(own.body).toMatchObject({ ppa: 'dpjp', status: 'final', cosignRequired: false });
    const self = await as('dokter').post(`/cppt/entries/${own.body.id}/cosign`, { note: null });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('COSIGN_NOT_ALLOWED');
    // Visite DPJP tercatat sekali sebagai peristiwa biaya.
    const visite = await run(A.id, (tx) =>
      tx.billableEvent.findMany({ where: { sourceType: 'cppt_entries', sourceId: own.body.id } }),
    );
    expect(visite).toHaveLength(1);
    expect(visite[0]?.kind).toBe('visite');
    const event = await run(A.id, (tx) =>
      tx.domainEvent.findFirst({
        where: { name: 'cppt.finalized', payload: { path: ['cpptId'], equals: r.body.id } },
      }),
    );
    expect(event?.payload).toMatchObject({ cosignRequired: true, encounterId: e.encounterId });
  });

  it('co-sign serentak dua DPJP → [201, 409]', async () => {
    const e = await inpatient([
      ['dokter', 'dpjp_utama'],
      ['dokter2', 'rawat_bersama'],
    ]);
    const r = await as('residen').post('/cppt/entries', soap(e.encounterId)).expect(201);
    const results = await Promise.all([
      as('dokter').post(`/cppt/entries/${r.body.id}/cosign`, { note: null }),
      as('dokter2').post(`/cppt/entries/${r.body.id}/cosign`, { note: null }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([201, 409]);
  });

  it('koreksi hanya penulis (residen mengoreksi → menunggu co-sign lagi); addendum PPA lain; salah entri', async () => {
    const e = await inpatient();
    const v1 = await as('perawat').post('/cppt/entries', soap(e.encounterId)).expect(201);
    const byOther = await as('dokter').post(
      '/cppt/entries',
      soap(e.encounterId, {
        revision: {
          kind: 'koreksi',
          supersedesId: v1.body.id,
          correctionReason: 'Bukan penulis catatan ini',
        },
      }),
    );
    expect(byOther.status).toBe(403);
    expect(byOther.body.code).toBe('RECORD_NOT_AUTHOR');
    const add = await as('dokter')
      .post('/cppt/entries', soap(e.encounterId, { revision: { kind: 'addendum', addendumOf: v1.body.id } }))
      .expect(201);
    expect(add.body).toMatchObject({ addendumOf: v1.body.id, ppa: 'dpjp' });

    const res = await as('residen').post('/cppt/entries', soap(e.encounterId)).expect(201);
    await as('dokter').post(`/cppt/entries/${res.body.id}/cosign`, { note: null }).expect(201);
    const corrected = await as('residen')
      .post(
        '/cppt/entries',
        soap(e.encounterId, {
          revision: {
            kind: 'koreksi',
            supersedesId: res.body.id,
            correctionReason: 'Tambah hasil rontgen toraks',
          },
        }),
      )
      .expect(201);
    expect(corrected.body).toMatchObject({ version: 2, status: 'menunggu_cosign', cosign: null });
    // Co-sign versi lama yang sudah digantikan → 409.
    const stale = await as('dokter').post(`/cppt/entries/${res.body.id}/cosign`, { note: null });
    expect(stale.status).toBe(409);

    await as('perawat')
      .post(`/cppt/entries/${v1.body.id}/entered-in-error`, { reason: 'Catatan untuk pasien lain' })
      .expect(201);
    const list = await as('dokter').get(`/encounters/${e.encounterId}/cppt`).expect(200);
    expect(list.body.map((x: { id: string }) => x.id)).not.toContain(v1.body.id);
    expect(list.body.map((x: { id: string }) => x.id)).toContain(corrected.body.id);
  });

  it('singkatan terlarang = peringatan (tidak memblokir)', async () => {
    const e = await inpatient();
    const r = await as('dokter')
      .post(
        '/cppt/entries',
        soap(e.encounterId, {
          content: { format: 'soap', s: 'Lemas', o: 'GDS 320', a: 'Hiperglikemia', p: 'Insulin 10 U SC' },
        }),
      )
      .expect(201);
    expect(r.body.abbreviationWarnings).toEqual([expect.stringMatching(/^U: /)]);
  });

  it('izin unit + isolasi: perawat unit lain 403, kasir 403, tenant lain 404', async () => {
    const e = await inpatient();
    await as('perawatAnggrek').post('/cppt/entries', soap(e.encounterId)).expect(403);
    await as('perawatAnggrek').get(`/encounters/${e.encounterId}/cppt`).expect(403);
    await as('kasir').get(`/encounters/${e.encounterId}/cppt`).expect(403);
    await as('dokterB').get(`/encounters/${e.encounterId}/cppt`).expect(404);
  });
});

describe('verifikasi DPJP + worklist (K01)', () => {
  it('CPPT perawat lewat cppt.verify_hours → tugas verifikasi; co-sign/EWS/serah terima di worklist; verifikasi menutup tugas', async () => {
    const e = await inpatient();
    const late = await as('perawat')
      .post('/cppt/entries', soap(e.encounterId, { occurredAt: hoursAgo(30) }))
      .expect(201);
    expect(late.body.lateEntry).toBe(true);
    const fresh = await as('perawat').post('/cppt/entries', soap(e.encounterId)).expect(201);
    const res = await as('residen').post('/cppt/entries', soap(e.encounterId)).expect(201);
    await as('perawat')
      .post(`/encounters/${e.encounterId}/observations`, {
        encounterId: e.encounterId,
        occurredAt: hoursAgo(0.02),
        temp: 38.5,
        hr: 125,
        rr: 26,
        sbp: 95,
        dbp: 60,
        spo2: 90,
        onOxygen: true,
        consciousness: 'A',
        weightKg: null,
      })
      .expect(201);
    await as('perawat')
      .post('/cppt/handovers', {
        encounterId: e.encounterId,
        occurredAt: hoursAgo(0.01),
        situation: 'Sesak meningkat',
        background: 'Pneumonia hari ke-3',
        assessment: 'NEWS2 tinggi',
        recommendation: 'Evaluasi DPJP segera',
        toUserId: users.dokter,
      })
      .expect(201);
    const note = await run(A.id, (tx) =>
      tx.notification.findFirst({ where: { recipientUserId: users.dokter, kind: 'handover' } }),
    );
    expect(note?.link).toBe(`/klinis/rawat-inap?kunjungan=${e.encounterId}`);

    const wl = await as('dokter').get('/worklist?view=dpjp').expect(200);
    const mine = (wl.body.tasks as Array<{ kind: string; targetId: string; encounterId: string }>).filter(
      (t) => t.encounterId === e.encounterId,
    );
    expect(mine.map((t) => t.kind).sort()).toEqual(['cosign', 'ews_high', 'verify']);
    expect(mine.find((t) => t.kind === 'verify')?.targetId).toBe(late.body.id);
    expect(mine.find((t) => t.kind === 'cosign')?.targetId).toBe(res.body.id);
    expect(mine.some((t) => t.targetId === fresh.body.id)).toBe(false);
    const patient = (
      wl.body.patients as Array<{ encounterId: string; ews: { risk: string }; pendingTasks: number }>
    ).find((p) => p.encounterId === e.encounterId);
    expect(patient).toMatchObject({ ews: { risk: 'tinggi' }, pendingTasks: 3 });
    const shift = await as('dokter').get('/worklist?view=shift').expect(200);
    expect(
      (shift.body.tasks as Array<{ kind: string; encounterId: string }>).some(
        (t) => t.kind === 'handover' && t.encounterId === e.encounterId,
      ),
    ).toBe(true);

    const verified = await as('dokter')
      .post(`/cppt/entries/${late.body.id}/verify`, { note: null })
      .expect(201);
    expect(verified.body.verification).toMatchObject({ kind: 'verify', by: { userId: users.dokter } });
    await as('dokter').post(`/cppt/entries/${late.body.id}/verify`, { note: null }).expect(409);
    await as('dokter').post(`/cppt/entries/${res.body.id}/verify`, { note: null }).expect(409);
    const after = await as('dokter').get('/worklist?view=tugas').expect(200);
    expect(
      (after.body.tasks as Array<{ kind: string; targetId: string }>).some(
        (t) => t.targetId === late.body.id,
      ),
    ).toBe(false);
    expect(after.body.patients).toEqual([]);

    // Perawat unit: pasien Melati tampil; tanpa tugas DPJP. Dokter tanpa tim: tidak ada tugas kunjungan ini.
    const unit = await as('perawat').get('/worklist?view=unit').expect(200);
    expect(
      (unit.body.patients as Array<{ encounterId: string }>).some((p) => p.encounterId === e.encounterId),
    ).toBe(true);
    expect((unit.body.tasks as Array<{ kind: string }>).some((t) => t.kind === 'cosign')).toBe(false);
    const outsider = await as('dokterLuar').get('/worklist?view=dpjp').expect(200);
    expect(
      (outsider.body.tasks as Array<{ encounterId: string }>).some((t) => t.encounterId === e.encounterId),
    ).toBe(false);
    await as('kasir').get('/worklist').expect(403);
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.count({
        where: { resourceType: 'worklist', patientId: e.patientId, actorUserId: users.dokter },
      }),
    );
    expect(audit).toBeGreaterThanOrEqual(1);

    const hs = await as('dokter').get(`/encounters/${e.encounterId}/handovers`).expect(200);
    expect(hs.body[0]).toMatchObject({
      recommendation: 'Evaluasi DPJP segera',
      toUser: { userId: users.dokter },
    });
  });
});

describe('asesmen per kunjungan (K06)', () => {
  const MORSE = {
    q_riwayat_jatuh: 'ya',
    q_diag_sekunder: 'ya',
    q_alat_bantu: 'furnitur',
    q_infus: 'tidak',
    q_gaya_jalan: 'normal',
    q_mental: 'sadar',
  };

  it('formulir P07 + encounterId (hak tulis per profesi); daftar asesmen kunjungan; kunjungan pasien lain 422', async () => {
    const e = await inpatient();
    const other = await inpatient();
    const url = `/patients/${e.patientId}/forms/morse_dewasa/responses`;
    const created = await as('perawat').post(url, { answers: MORSE, encounterId: e.encounterId }).expect(201);
    expect(created.body).toMatchObject({ encounterId: e.encounterId, current: { score: 70 } });
    // Hak tulis per profesi: dokter tidak tercantum di formulir Morse.
    await as('dokter').post(url, { answers: MORSE, encounterId: e.encounterId }).expect(403);
    await as('perawat').post(url, { answers: MORSE, encounterId: other.encounterId }).expect(422);
    // Koreksi tetap di kunjungan yang sama.
    const corrected = await as('perawat')
      .post(`/form-responses/${created.body.id}/corrections`, {
        answers: { ...MORSE, q_alat_bantu: 'kruk' },
        reason: 'Pasien memakai kruk, bukan furnitur',
      })
      .expect(201);
    expect(corrected.body.encounterId).toBe(e.encounterId);
    const list = await as('dokter').get(`/encounters/${e.encounterId}/assessments`).expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({ formCode: 'morse_dewasa', version: 2, score: 55, status: 'final' }),
    ]);
    await as('perawatAnggrek').get(`/encounters/${e.encounterId}/assessments`).expect(403);
    await as('dokterB').get(`/encounters/${e.encounterId}/assessments`).expect(404);
  });
});
