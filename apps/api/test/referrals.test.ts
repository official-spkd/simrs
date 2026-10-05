/**
 * F06/F07 · Surat kontrol, SPRI, rujukan keluar dan internal lewat API (fase 2 potongan 7): baris `pending` tanpa
 * nomor + outbox VClaim (API tidak memanggil BPJS), kunci outbox urut naik untuk kirim ulang/hapus, batal (bernomor →
 * hapus di BPJS; belum bernomor + gagal → lokal; sedang dikirim → 409), nomor RS untuk rujukan non-BPJS/internal,
 * relasi konsultan, ABAC (dokter tanpa relasi 403), izin, isolasi tenant. Hasil worker disimulasikan dengan kolom
 * yang sama yang ditulis worker (`apps/worker/test/referral-outbox.test.ts` menguji worker ↔ mock BPJS). Data fiktif.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createPrismaClient, seedFrontOffice, seedHospitalStructure, withTenant } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { isoDateJakarta, newId, outboxKey } from '@simrs/shared';
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
const http = () => request(app.getHttpServer());
let A: { id: string; code: string };
let B: { id: string; code: string };
const tok: Record<string, Tokens> = {};
let dpjpUserId: string;
const ids: Record<string, string> = {};

const today = isoDateJakarta(new Date());
const inDays = (n: number) => isoDateJakarta(new Date(Date.now() + n * 86_400_000));
let digitSeed = 0;
const uniqueDigits = (n: number) => {
  digitSeed += 1;
  return `${Date.now() % 1e7}${digitSeed}`.padStart(n, '0').slice(-n);
};
const run = <R>(tenantId: string, fn: Parameters<typeof withTenant<R>>[2]) =>
  withTenant(testDb(), tenantId, fn);

async function seededTenant() {
  const t = await createTestTenant();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, t.id, (tx) => seedHospitalStructure(tx, t.id));
    await seedFrontOffice(owner, t.id);
  } finally {
    await owner.$disconnect();
  }
  return t;
}

const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}, key?: string) => {
      const r = http().post(`/api/v1${url}`).set(auth());
      return (key === undefined ? r : r.set('Idempotency-Key', key)).send(body);
    },
  };
};
const outboxKeys = (operation: string) =>
  run(A.id, async (tx) =>
    (await tx.outboxMessage.findMany({ where: { operation }, select: { idempotencyKey: true } })).map(
      (m) => m.idempotencyKey,
    ),
  );
/** Hasil worker: kolom yang sama dengan yang ditulis `apps/worker/src/outbox/referral.ts`. */
const workerResult = (id: string, data: Record<string, unknown>) =>
  run(A.id, (tx) => tx.referral.update({ where: { id }, data }));
const numberIssued = (id: string, number: string) =>
  workerResult(id, {
    number,
    status: 'active',
    syncStatus: 'sent',
    syncedAt: new Date(),
    syncErrorCode: null,
  });

let sessionSeq = 0;
/** Kunjungan rawat jalan hari ini di poli PD (dr. Andini); BPJS → SEP v1 pending, `issueSep` menerbitkannya. */
async function outpatient(opts: { bpjs: boolean; issueSep?: boolean }) {
  sessionSeq += 1;
  const start = `${String(5 + Math.floor(sessionSeq / 60)).padStart(2, '0')}:${String(sessionSeq % 60).padStart(2, '0')}`;
  const sessionId = await run(A.id, async (tx) => {
    const id = newId();
    await tx.scheduleSession.create({
      data: {
        id,
        tenantId: A.id,
        practitionerId: ids.andini as string,
        serviceId: ids.PD as string,
        sessionDate: new Date(`${today}T00:00:00.000Z`),
        startTime: new Date(`1970-01-01T${start}:00.000Z`),
        endTime: new Date('1970-01-01T23:00:00.000Z'),
        quotaJkn: 20,
        quotaNonJkn: 20,
      },
    });
    return id;
  });
  const card = `0000${uniqueDigits(8)}1`;
  const p = await createTestPatient(A.id, {
    name: 'Pasien Rujukan Fiktif',
    identifiers: opts.bpjs
      ? { nik: `99990101900${uniqueDigits(5)}`, bpjs: card }
      : { nik: `99990101900${uniqueDigits(5)}` },
  });
  const res = await as('daftar')
    .post(
      '/registration/outpatient',
      {
        patientId: p.id,
        sessionId,
        coverage: opts.bpjs
          ? {
              payer: 'bpjs',
              visitKind: 'rujukan_fktp',
              referenceNumber: `9999P001${card.slice(-9)}01`,
              initialDiagnosis: { code: 'I10', display: 'Hipertensi esensial (primer)' },
            }
          : { payer: 'umum' },
        generalConsent: { confirmedByStaff: true, signer: 'pasien' },
      },
      newId(),
    )
    .expect(201);
  const r = res.body;
  if (opts.issueSep && r.sep) {
    await run(A.id, (tx) =>
      tx.sep.update({
        where: { id: r.sep.id },
        data: {
          status: 'issued',
          sepNo: `0301R0011026V${uniqueDigits(6)}`,
          issuedAt: new Date(),
          syncStatus: 'sent',
          syncedAt: new Date(),
        },
      }),
    );
  }
  return { encounterId: r.encounter.id as string, patientId: p.id };
}

beforeAll(async () => {
  app = await createTestApp();
  A = await seededTenant();
  B = await seededTenant();
  await run(A.id, async (tx) => {
    for (const s of await tx.queueService.findMany({ where: { code: { in: ['PD', 'JT'] } } }))
      ids[s.code] = s.id;
    for (const u of await tx.unit.findMany({ where: { code: { in: ['MELATI', 'IGD'] } } }))
      ids[u.code] = u.id;
    ids.andini = (
      await tx.practitioner.findFirstOrThrow({ where: { name: 'dr. Andini Prameswari, Sp.PD' } })
    ).id;
    ids.bagus = (await tx.practitioner.findFirstOrThrow({ where: { name: { startsWith: 'dr. Bagus' } } })).id;
  });
  // Matriks RS A diatur seperti layar Akses: dokter membaca rujukan pasien berelasinya (sebelum login pertama).
  const owner0 = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner0, A.id, async (tx) => {
      const dokter = await tx.role.findFirstOrThrow({ where: { code: 'dokter' } });
      await tx.rolePermission.create({
        data: {
          tenantId: A.id,
          roleId: dokter.id,
          resource: 'referral',
          action: 'read',
          scope: 'relationship',
        },
      });
      await tx.rolePermission.create({
        data: {
          tenantId: A.id,
          roleId: dokter.id,
          resource: 'referral',
          action: 'write',
          scope: 'relationship',
        },
      });
    });
  } finally {
    await owner0.$disconnect();
  }
  for (const [who, t, role] of [
    ['daftar', A, 'petugas_pendaftaran'],
    ['kasir', A, 'kasir'],
    ['perawat', A, 'perawat'],
    ['dokterLain', A, 'dokter'],
    ['rsB', B, 'petugas_pendaftaran'],
  ] as const) {
    tok[who] = await login(app, await createTestUser(t.id, { roles: [{ code: role }], tenantCode: t.code }));
  }
  const dokter = await createTestUser(A.id, { roles: [{ code: 'dokter' }], tenantCode: A.code });
  dpjpUserId = dokter.id;
  tok.dpjp = await login(app, dokter);
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, A.id, (tx) =>
      tx.practitioner.update({ where: { id: ids.andini as string }, data: { userId: dokter.id } }),
    );
  } finally {
    await owner.$disconnect();
  }
});

afterAll(async () => {
  await app?.close();
});

const kontrol = (encounterId: string, extra: Record<string, unknown> = {}) => ({
  kind: 'surat-kontrol',
  encounterId,
  plannedDate: inDays(7),
  practitionerId: ids.bagus,
  targetServiceId: ids.JT,
  ...extra,
});

describe('surat kontrol (rencana kontrol)', () => {
  it('butuh SEP terbit; pending + outbox; ditolak → kirim ulang urut 2; terbit → batal = hapus di BPJS urut 3', async () => {
    const pending = await outpatient({ bpjs: true });
    expect(
      (await as('daftar').post('/referrals/control-letters', kontrol(pending.encounterId)).expect(409)).body
        .code,
    ).toBe('SEP_STATE_INVALID');

    const e = await outpatient({ bpjs: true, issueSep: true });
    await as('daftar')
      .post('/referrals/control-letters', kontrol(e.encounterId, { plannedDate: inDays(-1) }))
      .expect(422);
    const created = await as('daftar').post('/referrals/control-letters', kontrol(e.encounterId)).expect(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({
      kind: 'surat-kontrol',
      status: 'pending',
      number: null,
      patientId: e.patientId,
      encounterId: e.encounterId,
      targetServiceId: ids.JT,
      practitionerId: ids.bagus,
      plannedDate: inDays(7),
      validUntil: inDays(7),
      issuedOn: today,
      // Diagnosa dari SEP kunjungan asal.
      diagnosis: { code: 'I10' },
      sync: { status: 'pending', sentAt: null, error: null },
    });
    expect(await outboxKeys('bpjs.vclaim.rencanakontrol.insert')).toContain(
      outboxKey('bpjs.vclaim.rencanakontrol.insert', id, 1),
    );
    // Masih dikirim: belum bisa dibatalkan atau dikirim ulang.
    await as('daftar').post(`/referrals/${id}/cancel`, { reason: 'Salah tanggal' }).expect(409);
    await as('daftar').post(`/referrals/${id}/retry`).expect(409);

    await workerResult(id, { syncStatus: 'rejected', syncErrorCode: 'BPJS_JADWAL_TIDAK_DITEMUKAN' });
    expect((await as('daftar').get(`/referrals/${id}`).expect(200)).body.sync).toEqual({
      status: 'rejected',
      sentAt: null,
      error: { code: 'BPJS_JADWAL_TIDAK_DITEMUKAN', message: 'Jadwal dokter tidak ditemukan' },
    });
    const retried = await as('daftar').post(`/referrals/${id}/retry`).expect(200);
    expect(retried.body.sync).toMatchObject({ status: 'pending', error: null });
    expect(await outboxKeys('bpjs.vclaim.rencanakontrol.insert')).toContain(
      outboxKey('bpjs.vclaim.rencanakontrol.insert', id, 2),
    );

    await numberIssued(id, `0301R0011026K${uniqueDigits(6)}`);
    const cancelled = await as('daftar')
      .post(`/referrals/${id}/cancel`, { reason: 'Pasien pindah RS' })
      .expect(200);
    expect(cancelled.body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Pasien pindah RS',
      sync: { status: 'pending' },
    });
    expect(await outboxKeys('bpjs.vclaim.rencanakontrol.delete')).toContain(
      outboxKey('bpjs.vclaim.rencanakontrol.delete', id, 3),
    );
    await as('daftar').post(`/referrals/${id}/cancel`, { reason: 'Batal kedua kali' }).expect(409);
    // Rujukan batal beku (database), kecuali status kirim hapus.
    await expect(workerResult(id, { validUntil: new Date(`${inDays(30)}T00:00:00.000Z`) })).rejects.toThrow(
      /REFERRAL_IMMUTABLE/,
    );
    await workerResult(id, { syncStatus: 'sent', syncedAt: new Date() });
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findMany({
        where: { resourceType: 'referral', resourceId: id },
        orderBy: { seq: 'asc' },
      }),
    );
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['create', 'read', 'update']));
    expect(audit.every((a) => a.patientId === e.patientId)).toBe(true);
  });

  it('penjamin non-BPJS 422; poli/DPJP tak terpetakan 422', async () => {
    const umum = await outpatient({ bpjs: false });
    await as('daftar').post('/referrals/control-letters', kontrol(umum.encounterId)).expect(422);
    const e = await outpatient({ bpjs: true, issueSep: true });
    await as('daftar')
      .post('/referrals/control-letters', kontrol(e.encounterId, { targetServiceId: newId() }))
      .expect(422);
    await as('daftar')
      .post('/referrals/control-letters', kontrol(e.encounterId, { practitionerId: newId() }))
      .expect(422);
  });
});

describe('SPRI', () => {
  it('pending + outbox (poli DPJP dari jadwal); ditolak → batal lokal; terbit + dipakai admisi → tidak bisa dibatalkan', async () => {
    const e = await outpatient({ bpjs: true });
    const body = {
      kind: 'spri',
      encounterId: e.encounterId,
      plannedDate: inDays(1),
      practitionerId: ids.andini,
      unitId: ids.MELATI,
    };
    await as('daftar')
      .post('/referrals/control-letters', { ...body, unitId: ids.IGD })
      .expect(422);
    const first = await as('daftar').post('/referrals/control-letters', body).expect(201);
    expect(first.body).toMatchObject({
      kind: 'spri',
      status: 'pending',
      targetUnitId: ids.MELATI,
      targetServiceId: ids.PD,
      facilityName: 'Bangsal Melati',
    });
    expect(await outboxKeys('bpjs.vclaim.spri.insert')).toContain(
      outboxKey('bpjs.vclaim.spri.insert', first.body.id, 1),
    );
    await workerResult(first.body.id, { syncStatus: 'dead', syncErrorCode: 'BPJS_DLQ' });
    const localCancel = await as('daftar')
      .post(`/referrals/${first.body.id}/cancel`, { reason: 'Diganti SPRI baru' })
      .expect(200);
    expect(localCancel.body).toMatchObject({ status: 'cancelled', number: null, sync: { status: 'dead' } });
    expect(await outboxKeys('bpjs.vclaim.rencanakontrol.delete')).not.toContain(
      outboxKey('bpjs.vclaim.rencanakontrol.delete', first.body.id, 2),
    );

    const second = await as('daftar').post('/referrals/control-letters', body).expect(201);
    await numberIssued(second.body.id, `0301R0011026K${uniqueDigits(6)}`);
    await as('daftar')
      .post(
        '/registration/admissions',
        {
          patientId: e.patientId,
          sourceEncounterId: e.encounterId,
          spriReferralId: second.body.id,
          unitId: ids.MELATI,
          practitionerId: ids.andini,
          careClass: 'kelas_2',
          plannedAt: new Date(Date.now() + 86_400_000).toISOString(),
          coverage: {
            payer: 'bpjs',
            visitKind: 'rujukan_fktp',
            referenceNumber: '9999P001000000001',
            initialDiagnosis: { code: 'I10', display: 'Hipertensi esensial (primer)' },
          },
          generalConsent: { confirmedByStaff: true, signer: 'pasien' },
        },
        newId(),
      )
      .expect(201);
    expect(
      (await as('daftar').post(`/referrals/${second.body.id}/cancel`, { reason: 'Batal rawat' }).expect(409))
        .body.message,
    ).toMatch(/admisi/);
  });
});

describe('rujukan keluar dan internal', () => {
  it('keluar BPJS: pending + outbox (butuh SEP terbit); non-BPJS: nomor RS RK-…; rujuk balik tanpa poli', async () => {
    const e = await outpatient({ bpjs: true, issueSep: true });
    const out = {
      encounterId: e.encounterId,
      destination: { ppkCode: '0301R002', name: 'RS Fiktif Bahari' },
      serviceType: 'rawat_jalan',
      bpjsPoliCode: 'JAN',
      diagnosis: { code: 'I10', display: 'Hipertensi esensial (primer)' },
      plannedDate: inDays(3),
      note: 'Mohon evaluasi jantung',
    };
    const bpjs = await as('daftar').post('/referrals/outgoing', out).expect(201);
    expect(bpjs.body).toMatchObject({
      kind: 'rujukan-keluar',
      status: 'pending',
      number: null,
      ppkCode: '0301R002',
      referralType: 'penuh',
      serviceType: 'rawat_jalan',
      bpjsPoliCode: 'JAN',
      note: 'Mohon evaluasi jantung',
      sync: { status: 'pending' },
    });
    expect(await outboxKeys('bpjs.vclaim.rujukan.insert')).toContain(
      outboxKey('bpjs.vclaim.rujukan.insert', bpjs.body.id, 1),
    );
    const noSep = await outpatient({ bpjs: true });
    await as('daftar')
      .post('/referrals/outgoing', { ...out, encounterId: noSep.encounterId })
      .expect(409);

    const umum = await outpatient({ bpjs: false });
    const local = await as('daftar')
      .post('/referrals/outgoing', {
        ...out,
        encounterId: umum.encounterId,
        destination: { ppkCode: '9999P001', name: 'Puskesmas Fiktif Satu' },
        referralType: 'rujuk_balik',
        bpjsPoliCode: undefined,
      })
      .expect(201);
    expect(local.body).toMatchObject({
      status: 'active',
      referralType: 'rujuk_balik',
      sync: { status: 'not_required' },
    });
    expect(local.body.number).toMatch(/^RK-\d{4}-\d{6}$/);
    const c = await as('daftar')
      .post(`/referrals/${local.body.id}/cancel`, { reason: 'Pasien menolak' })
      .expect(200);
    expect(c.body).toMatchObject({ status: 'cancelled', sync: { status: 'not_required' } });
  });

  it('internal: nomor RIN-…, alasan tersimpan, dokter tujuan mendapat relasi konsultan; poli sama 422', async () => {
    const e = await outpatient({ bpjs: false });
    await as('daftar')
      .post('/referrals/internal', {
        encounterId: e.encounterId,
        targetServiceId: ids.PD,
        reason: 'Konsul ulang',
      })
      .expect(422);
    const r = await as('daftar')
      .post('/referrals/internal', {
        encounterId: e.encounterId,
        targetServiceId: ids.JT,
        practitionerId: ids.andini,
        reason: 'Konsul jantung pra-tindakan',
      })
      .expect(201);
    expect(r.body).toMatchObject({
      kind: 'rujukan-internal',
      status: 'active',
      note: 'Konsul jantung pra-tindakan',
      targetServiceId: ids.JT,
      sync: { status: 'not_required' },
    });
    expect(r.body.number).toMatch(/^RIN-\d{4}-\d{6}$/);
    const rel = await run(A.id, (tx) =>
      tx.accessRelationship.findMany({
        where: { patientId: e.patientId, userId: dpjpUserId, kind: 'konsultan' },
      }),
    );
    expect(rel).toHaveLength(1);
  });
});

describe('ABAC, izin, isolasi', () => {
  it('dokter berelasi membaca; dokter lain 403 (diaudit); daftar tanpa pasien 422 bagi lingkup relasi; kasir/perawat 403', async () => {
    const e = await outpatient({ bpjs: false });
    const r = await as('daftar')
      .post('/referrals/internal', {
        encounterId: e.encounterId,
        targetServiceId: ids.JT,
        reason: 'Konsul jantung',
      })
      .expect(201);
    expect(
      (await as('daftar').get(`/referrals?patientId=${e.patientId}`).expect(200)).body.items,
    ).toHaveLength(1);
    await as('dpjp').get(`/referrals/${r.body.id}`).expect(200);
    expect(
      (await as('dpjp').get(`/referrals?encounterId=${e.encounterId}`).expect(200)).body.items.map(
        (i: { id: string }) => i.id,
      ),
    ).toEqual([r.body.id]);
    const denied = await as('dokterLain').get(`/referrals/${r.body.id}`).expect(403);
    expect(denied.body.details).toMatchObject({ breakGlassAvailable: true });
    await as('dokterLain').get(`/referrals?patientId=${e.patientId}`).expect(403);
    await as('dokterLain').get('/referrals').expect(422);
    await as('dokterLain').post(`/referrals/${r.body.id}/cancel`, { reason: 'Coba batal' }).expect(403);
    await as('kasir').get(`/referrals/${r.body.id}`).expect(403);
    await as('perawat')
      .post('/referrals/internal', { encounterId: e.encounterId, targetServiceId: ids.JT, reason: 'Konsul' })
      .expect(403);
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findMany({ where: { patientId: e.patientId, action: 'access_denied' } }),
    );
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('isolasi tenant: RS B tidak bisa membaca, membatalkan, atau membuat rujukan dari kunjungan RS A', async () => {
    const e = await outpatient({ bpjs: true, issueSep: true });
    const r = await as('daftar').post('/referrals/control-letters', kontrol(e.encounterId)).expect(201);
    await as('rsB').get(`/referrals/${r.body.id}`).expect(404);
    await as('rsB').post(`/referrals/${r.body.id}/cancel`, { reason: 'Batal dari RS B' }).expect(404);
    await as('rsB').post('/referrals/control-letters', kontrol(e.encounterId)).expect(404);
    await as('rsB')
      .post('/referrals/internal', { encounterId: e.encounterId, targetServiceId: ids.JT, reason: 'Konsul' })
      .expect(404);
    expect((await as('rsB').get(`/referrals?patientId=${e.patientId}`).expect(200)).body.items).toEqual([]);
    expect(await run(B.id, (tx) => tx.referral.count({ where: { id: r.body.id } }))).toBe(0);
  });
});
