/**
 * Fase 3 · potongan 3.8 · konsultasi/rawat bersama/alih rawat (K10), serah DPJP utama, paket formulir + kelengkapan
 * (K15, EP 6b/7a), ADR-0059: konsul hanya dijawab konsultan tujuan, konsultan mendapat akses berbatas waktu, tim
 * perawatan dan relasi akses ikut berubah, kelengkapan per setting, izin + isolasi tenant. Data fiktif.
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
    put: (url: string, body: object = {}) => http().put(`/api/v1${url}`).set(auth()).send(body),
  };
};

async function clinicalTenant() {
  const t = await createTestTenant();
  await owner(t.id, async (tx) => {
    await seedHospitalStructure(tx, t.id);
    await ensurePublishedForm(tx, t.id, MORSE_FALL_SCALE);
    await seedClinicalMasters(tx, t.id);
  });
  return t;
}

let seq = 0;
/** Kunjungan pasien di Melati (IMP) atau poli (AMB); dokter = DPJP utama (relasi akses). */
async function visit(encounterClass: 'IMP' | 'AMB' = 'IMP') {
  const p = await createTestPatient(A.id, { name: 'Pasien Konsul Fiktif' });
  seq += 1;
  return run(A.id, async (tx) => {
    const enc = await tx.encounter.create({
      data: {
        id: newId(),
        tenantId: A.id,
        number: `KS-2610-${String(Date.now() % 1e5).padStart(5, '0')}${seq}`,
        patientId: p.id,
        encounterClass,
        status: 'in_progress',
        unitId: encounterClass === 'IMP' ? (units.MELATI as string) : (units['POLI-DALAM'] as string),
        plannedAt: encounterClass === 'IMP' ? new Date() : null,
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
    return { patientId: p.id, encounterId: enc.id };
  });
}

const ask = (encounterId: string, over: object = {}) => ({
  encounterId,
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
  kind: 'konsultasi',
  urgency: 'biasa',
  toUserId: users.konsultan,
  toUnitId: null,
  question: 'Mohon evaluasi nyeri dada atipikal dan EKG perubahan ST ringan',
  revision: { kind: 'baru' },
  ...over,
});
const answer = (over: object = {}) => ({
  occurredAt: new Date().toISOString(),
  findings: 'EKG sinus ritme, troponin negatif',
  assessment: 'Nyeri dada non-kardiak',
  recommendation: 'Tidak perlu tindakan kardiologi; lanjutkan analgesik',
  accept: false,
  revision: { kind: 'baru' },
  ...over,
});

beforeAll(async () => {
  app = await createTestApp();
  A = await clinicalTenant();
  B = await clinicalTenant();
  for (const code of ['MELATI', 'POLI-JANTUNG', 'POLI-DALAM']) {
    units[code] = (await run(A.id, (tx) => tx.unit.findFirstOrThrow({ where: { code } }))).id;
  }
  for (const [who, t, role, unitCode] of [
    ['dokter', A, 'dokter', 'MELATI'],
    ['konsultan', A, 'dokter', 'POLI-JANTUNG'],
    ['jantung2', A, 'dokter', 'POLI-JANTUNG'],
    ['dokterLain', A, 'dokter', 'POLI-DALAM'],
    ['residen', A, 'dokter_residen', 'MELATI'],
    ['perawat', A, 'perawat', 'MELATI'],
    ['rm', A, 'petugas_rm', undefined],
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

describe('konsultasi (K10)', () => {
  it('konsul ke dokter tertentu: konsultan dapat akses berbatas waktu + notifikasi; hanya konsultan yang menjawab', async () => {
    const e = await visit();
    // Sebelum konsul: konsultan (unit lain, tanpa relasi) tidak bisa membuka pasien.
    await as('konsultan').get(`/encounters/${e.encounterId}/consults`).expect(403);
    const r = await as('dokter').post('/consults/requests', ask(e.encounterId)).expect(201);
    expect(r.body).toMatchObject({ state: 'menunggu', toUser: { userId: users.konsultan }, responses: [] });
    expect(Date.parse(r.body.dueAt) - Date.parse(r.body.occurredAt)).toBe(24 * 3_600_000);
    const grant = await run(A.id, (tx) =>
      tx.accessRelationship.findFirstOrThrow({
        where: { userId: users.konsultan, patientId: e.patientId, sourceType: 'consult_request' },
      }),
    );
    expect(grant.kind).toBe('konsultan');
    expect(grant.validUntil!.getTime() - grant.validFrom.getTime()).toBe(24 * 3_600_000);
    const note = await run(A.id, (tx) =>
      tx.notification.findFirst({ where: { recipientUserId: users.konsultan, kind: 'consult_request' } }),
    );
    expect(note?.body).not.toContain('Pasien Konsul Fiktif');
    const inbox = await as('konsultan').get('/consults/inbox').expect(200);
    expect(inbox.body.map((i: { requestId: string }) => i.requestId)).toContain(r.body.id);

    // Konsul hanya dijawab konsultan tujuan: pengirim, dokter lain, dokter seunit konsultan, residen, perawat → 403.
    for (const who of ['dokter', 'dokterLain', 'jantung2', 'residen', 'perawat']) {
      const denied = await as(who).post(`/consults/requests/${r.body.id}/responses`, answer()).expect(403);
      expect(denied.body.code, who).toBe('CONSULT_NOT_RECIPIENT');
    }
    const ok = await as('konsultan').post(`/consults/requests/${r.body.id}/responses`, answer()).expect(201);
    expect(ok.body).toMatchObject({ state: 'dijawab' });
    expect(ok.body.responses[0]).toMatchObject({
      followUp: 'selesai',
      accept: false,
      author: { userId: users.konsultan },
    });
    // Satu jawaban per konsul; koreksi lewat revisi.
    await as('konsultan').post(`/consults/requests/${r.body.id}/responses`, answer()).expect(409);
    const fixed = await as('konsultan')
      .post(
        `/consults/requests/${r.body.id}/responses`,
        answer({
          recommendation: 'Lanjutkan analgesik, kontrol poli jantung bila nyeri berulang',
          revision: {
            kind: 'koreksi',
            supersedesId: ok.body.responses[0].id,
            correctionReason: 'Tambah rencana kontrol',
          },
        }),
      )
      .expect(201);
    expect(fixed.body.responses).toHaveLength(1);
    expect(fixed.body.responses[0].version).toBe(2);
    // Biaya konsultasi sekali per rantai; akses konsultan berakhir 24 jam setelah jawaban.
    expect(
      await run(A.id, (tx) =>
        tx.billableEvent.count({ where: { encounterId: e.encounterId, kind: 'konsultasi' } }),
      ),
    ).toBe(1);
    const after = await run(A.id, (tx) =>
      tx.accessRelationship.findUniqueOrThrow({ where: { id: grant.id } }),
    );
    expect(after.validUntil!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(await as('konsultan').get('/consults/inbox').expect(200)).toMatchObject({ body: [] });
    // Akses kedaluwarsa → konsultan tidak bisa membuka pasien lagi.
    await owner(A.id, (tx) =>
      tx.accessRelationship.updateMany({
        where: { patientId: e.patientId, userId: users.konsultan },
        data: { validFrom: new Date(Date.now() - 3 * 86_400_000), validUntil: new Date(Date.now() - 60_000) },
      }),
    );
    await as('konsultan').get(`/encounters/${e.encounterId}/consults`).expect(403);
  });

  it('konsul ke unit: dokter unit tujuan menjawab; pengirim harus dokter; tujuan bukan diri sendiri', async () => {
    const e = await visit();
    await as('perawat').post('/consults/requests', ask(e.encounterId)).expect(403);
    await as('dokter')
      .post('/consults/requests', ask(e.encounterId, { toUserId: users.dokter }))
      .expect(422);
    await as('dokter')
      .post('/consults/requests', ask(e.encounterId, { question: 'Terlalu pendek' }))
      .expect(400);
    const r = await as('residen')
      .post('/consults/requests', ask(e.encounterId, { toUserId: null, toUnitId: units['POLI-JANTUNG'] }))
      .expect(201);
    expect(r.body.toUnit).toMatchObject({ id: units['POLI-JANTUNG'] });
    const inbox = await as('jantung2').get('/consults/inbox').expect(200);
    expect(inbox.body.map((i: { requestId: string }) => i.requestId)).toContain(r.body.id);
    await as('dokterLain').post(`/consults/requests/${r.body.id}/responses`, answer()).expect(403);
    const ok = await as('jantung2').post(`/consults/requests/${r.body.id}/responses`, answer()).expect(201);
    expect(ok.body.responses[0].author.userId).toBe(users.jantung2);
  });

  it('rawat bersama diterima → anggota tim; alih rawat diterima → DPJP utama berganti, relasi akses ikut', async () => {
    const e = await visit();
    const rb = await as('dokter')
      .post('/consults/requests', ask(e.encounterId, { kind: 'rawat_bersama', urgency: 'segera' }))
      .expect(201);
    expect(Date.parse(rb.body.dueAt) - Date.parse(rb.body.occurredAt)).toBe(3_600_000);
    const acc = await as('konsultan')
      .post(`/consults/requests/${rb.body.id}/responses`, answer({ accept: true }))
      .expect(201);
    expect(acc.body.responses[0].followUp).toBe('rawat_bersama');
    let team = await as('dokter').get(`/encounters/${e.encounterId}/care-team`).expect(200);
    expect(
      team.body
        .filter((m: { endedAt: string | null }) => !m.endedAt)
        .map((m: { role: string; user: { userId: string } }) => [m.role, m.user.userId]),
    ).toEqual(
      expect.arrayContaining([
        ['dpjp_utama', users.dokter],
        ['rawat_bersama', users.konsultan],
      ]),
    );
    const careRel = await run(A.id, (tx) =>
      tx.accessRelationship.findFirst({
        where: { userId: users.konsultan, patientId: e.patientId, kind: 'rawat_bersama', validUntil: null },
      }),
    );
    expect(careRel).not.toBeNull();

    const ar = await as('dokter')
      .post('/consults/requests', ask(e.encounterId, { kind: 'alih_rawat', toUserId: users.jantung2 }))
      .expect(201);
    await as('jantung2')
      .post(`/consults/requests/${ar.body.id}/responses`, answer({ accept: true }))
      .expect(201);
    team = await as('jantung2').get(`/encounters/${e.encounterId}/care-team`).expect(200);
    const primary = team.body.filter((m: { role: string }) => m.role === 'dpjp_utama');
    expect(primary.find((m: { endedAt: string | null }) => !m.endedAt)?.user.userId).toBe(users.jantung2);
    expect(
      primary.find((m: { user: { userId: string } }) => m.user.userId === users.dokter)?.endedAt,
    ).not.toBeNull();
    const oldRel = await run(A.id, (tx) =>
      tx.accessRelationship.findFirstOrThrow({
        where: { userId: users.dokter, patientId: e.patientId, kind: 'dpjp' },
      }),
    );
    expect(oldRel.validUntil).not.toBeNull();
  });

  it('serah DPJP utama langsung: hanya DPJP utama aktif; dokter baru mendapat akses', async () => {
    const e = await visit();
    await as('dokterLain').get(`/encounters/${e.encounterId}/care-team`).expect(403);
    const body = { userId: users.dokterLain, reason: 'Pasien dialihkan ke SMF Penyakit Dalam' };
    await as('residen').post(`/encounters/${e.encounterId}/care-team/primary`, body).expect(403);
    await as('dokter')
      .post(`/encounters/${e.encounterId}/care-team/primary`, { ...body, userId: users.perawat })
      .expect(422);
    await as('dokter')
      .post(`/encounters/${e.encounterId}/care-team/primary`, { ...body, reason: 'pendek' })
      .expect(400);
    const r = await as('dokter').post(`/encounters/${e.encounterId}/care-team/primary`, body).expect(201);
    const active = r.body.filter(
      (m: { endedAt: string | null; role: string }) => !m.endedAt && m.role === 'dpjp_utama',
    );
    expect(active.map((m: { user: { userId: string } }) => m.user.userId)).toEqual([users.dokterLain]);
    await as('dokterLain').get(`/encounters/${e.encounterId}/care-team`).expect(200);
    // DPJP lama tidak lagi bisa menyerahkan.
    await as('dokter')
      .post(`/encounters/${e.encounterId}/care-team/primary`, { ...body, userId: users.konsultan })
      .expect(403);
  });

  it('isolasi tenant: dokter RS lain 404 untuk konsul, tim, kelengkapan, dan jawaban', async () => {
    const e = await visit();
    const r = await as('dokter').post('/consults/requests', ask(e.encounterId)).expect(201);
    await as('dokterB').get(`/encounters/${e.encounterId}/consults`).expect(404);
    await as('dokterB').get(`/encounters/${e.encounterId}/care-team`).expect(404);
    await as('dokterB').get(`/encounters/${e.encounterId}/completeness`).expect(404);
    await as('dokterB').post(`/consults/requests/${r.body.id}/responses`, answer()).expect(404);
    await as('dokterB')
      .post('/consults/requests', ask(e.encounterId, { toUserId: users.dokterB }))
      .expect(404);
    expect((await as('dokterB').get('/consults/inbox').expect(200)).body).toEqual([]);
  });
});

describe('paket formulir + kelengkapan (K15)', () => {
  it('paket per setting; ubah hanya pengelola formulir', async () => {
    const igd = await as('dokter').get('/care-packages?setting=igd').expect(200);
    expect(igd.body).toEqual([
      expect.objectContaining({ formCode: MORSE_FALL_SCALE.code, required: true, active: true }),
    ]);
    await as('dokter').get('/care-packages?setting=kamar').expect(400);
    await as('dokter')
      .put(`/care-packages/rawat_jalan/${MORSE_FALL_SCALE.code}`, {
        required: true,
        sortOrder: 0,
        active: true,
      })
      .expect(403);
    await as('rm')
      .put('/care-packages/igd/tidak_ada', { required: true, sortOrder: 0, active: true })
      .expect(404);
    const upd = await as('rm')
      .put(`/care-packages/rawat_jalan/${MORSE_FALL_SCALE.code}`, {
        required: false,
        sortOrder: 1,
        active: true,
      })
      .expect(200);
    expect(upd.body).toMatchObject({ required: false, sortOrder: 1, formTitle: MORSE_FALL_SCALE.title });
  });

  it('kelengkapan per setting: RI wajib Morse (belum → lengkap setelah diisi); RJ Morse tidak wajib', async () => {
    const ri = await visit('IMP');
    // Isian formulir (`forms.response.write`) berlingkup relasi: perawat penanggung jawab.
    await run(A.id, (tx) =>
      tx.accessRelationship.create({
        data: {
          id: newId(),
          tenantId: A.id,
          userId: users.perawat as string,
          patientId: ri.patientId,
          kind: 'perawat_penanggung_jawab',
          validFrom: new Date(Date.now() - 60_000),
        },
      }),
    );
    const before = await as('perawat').get(`/encounters/${ri.encounterId}/completeness`).expect(200);
    expect(before.body).toMatchObject({
      setting: 'rawat_inap',
      complete: false,
      requiredFilled: 0,
      requiredTotal: 1,
    });
    const morse = {
      q_riwayat_jatuh: 'ya',
      q_diag_sekunder: 'ya',
      q_alat_bantu: 'furnitur',
      q_infus: 'tidak',
      q_gaya_jalan: 'normal',
      q_mental: 'sadar',
    };
    await as('perawat')
      .post(`/patients/${ri.patientId}/forms/${MORSE_FALL_SCALE.code}/responses`, {
        answers: morse,
        encounterId: ri.encounterId,
      })
      .expect(201);
    const after = await as('dokter').get(`/encounters/${ri.encounterId}/completeness`).expect(200);
    expect(after.body).toMatchObject({ complete: true, requiredFilled: 1, requiredTotal: 1 });
    expect(after.body.items[0]).toMatchObject({ formCode: MORSE_FALL_SCALE.code, filled: true });

    const rj = await visit('AMB');
    const amb = await as('dokter').get(`/encounters/${rj.encounterId}/completeness`).expect(200);
    expect(amb.body).toMatchObject({ setting: 'rawat_jalan', complete: true, requiredTotal: 0 });
  });
});
