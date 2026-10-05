/**
 * F03/F06 · Registrasi rawat jalan + SEP lewat API (fase 2 potongan 5a): Idempotency-Key (ulang = hasil sama, isi
 * beda = 409, serentak = satu kunjungan), persetujuan umum, booking walk-in/check-in, kunjungan + tiket poli +
 * event `encounter.registered` (task 1/3), penjaminan, relasi DPJP (ABAC), SEP `pending` + outbox, mesin keadaan SEP
 * (revisi = versi baru, batal, kirim ulang, penjaminan terkunci), lookup sinkron ke mock BPJS/Dukcapil (termasuk
 * mock `gagal` → 503 tanpa menghentikan registrasi), kontak penanggung jawab, izin, audit, isolasi. Data fiktif.
 */
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createPrismaClient, seedFrontOffice, seedHospitalStructure, withTenant } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { isoDateJakarta, newId, outboxKey, printableVisitSchema } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../mock/src/config';
import { buildServer } from '../../mock/src/server';
import { MockState } from '../../mock/src/state';
import {
  bearer,
  createTestApp,
  createTestPatient,
  createTestTenant,
  createTestUser,
  jsonText,
  login,
  type Tokens,
  testDb,
} from './helpers';

let app: NestExpressApplication;
let mock: ReturnType<typeof buildServer>;
let mockState: MockState;
const http = () => request(app.getHttpServer());
let A: { id: string; code: string };
let B: { id: string; code: string };
const tok: Record<string, Tokens> = {};
let dokterUserId: string;

const today = isoDateJakarta(new Date());
let digitSeed = 0;
const uniqueDigits = (n: number) => {
  digitSeed += 1;
  return `${Date.now() % 1e7}${digitSeed}`.padStart(n, '0').slice(-n);
};

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

/** Sesi dr. Andini (poli PD) HARI INI dengan jam mulai unik. */
let sessionSeq = 0;
async function todaySession(tenantId: string, opts: { quotaJkn?: number; quotaNonJkn?: number } = {}) {
  sessionSeq += 1;
  const start = `${String(5 + Math.floor(sessionSeq / 60)).padStart(2, '0')}:${String(sessionSeq % 60).padStart(2, '0')}`;
  return withTenant(testDb(), tenantId, async (tx) => {
    const service = await tx.queueService.findFirstOrThrow({ where: { code: 'PD' } });
    const practitioner = await tx.practitioner.findFirstOrThrow({
      where: { name: 'dr. Andini Prameswari, Sp.PD' },
    });
    const id = newId();
    await tx.scheduleSession.create({
      data: {
        id,
        tenantId,
        practitionerId: practitioner.id,
        serviceId: service.id,
        sessionDate: new Date(`${today}T00:00:00.000Z`),
        startTime: new Date(`1970-01-01T${start}:00.000Z`),
        endTime: new Date('1970-01-01T23:00:00.000Z'),
        quotaJkn: opts.quotaJkn ?? 20,
        quotaNonJkn: opts.quotaNonJkn ?? 20,
      },
    });
    return { id, serviceId: service.id };
  });
}

/** Pasien fiktif: NIK 9999…, kartu 0000… (mock: aktif); `inactive` → kartu berakhiran 0000 (tidak aktif). */
async function makePatient(tenantId: string, opts: { jkn?: boolean; inactive?: boolean } = {}) {
  const card = opts.inactive ? `0000${uniqueDigits(5)}0000` : `0000${uniqueDigits(8)}1`;
  const p = await createTestPatient(tenantId, {
    name: 'Pasien Registrasi Fiktif',
    phone: `62812${uniqueDigits(8)}`,
    identifiers:
      opts.jkn === false
        ? { nik: `99990101900${uniqueDigits(5)}` }
        : { nik: `99990101900${uniqueDigits(5)}`, bpjs: card },
  });
  return { ...p, card };
}

const CONSENT = { confirmedByStaff: true, signer: 'pasien' } as const;
const DIAG = { code: 'I10', display: 'Hipertensi esensial (primer)' };
/** Nomor rujukan FKTP mock milik kartu (`<PPK FKTP><9 digit akhir kartu><urut>`). */
const rujukanNo = (card: string, urut = '01') => `9999P001${card.slice(-9)}${urut}`;
const bpjsCoverage = (card: string, extra: Record<string, unknown> = {}) => ({
  payer: 'bpjs',
  visitKind: 'rujukan_fktp',
  referenceNumber: rujukanNo(card),
  initialDiagnosis: DIAG,
  ...extra,
});

const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  return {
    get: (url: string) => http().get(`/api/v1${url}`).set(auth()),
    post: (url: string, body: object = {}, key?: string) => {
      const r = http().post(`/api/v1${url}`).set(auth());
      return (key === undefined ? r : r.set('Idempotency-Key', key)).send(body);
    },
    patch: (url: string, body: object) => http().patch(`/api/v1${url}`).set(auth()).send(body),
  };
};
const register = (who: string, body: object, key: string = newId()) =>
  as(who).post('/registration/outpatient', body, key);

const run = <R>(tenantId: string, fn: Parameters<typeof withTenant<R>>[2]) =>
  withTenant(testDb(), tenantId, fn);
const outboxKeys = (tenantId: string, operation: string) =>
  run(tenantId, async (tx) =>
    (await tx.outboxMessage.findMany({ where: { operation }, select: { idempotencyKey: true } })).map(
      (m) => m.idempotencyKey,
    ),
  );

beforeAll(async () => {
  mockState = new MockState();
  mock = buildServer({ ...loadConfig({}), port: 0 }, mockState);
  await mock.listen({ port: 0, host: '127.0.0.1' });
  const port = (mock.server.address() as AddressInfo).port;
  app = await createTestApp({
    MOCK_BASE_URL: `http://127.0.0.1:${port}`,
    BPJS_BASE_URL: `http://127.0.0.1:${port}/bpjs`,
    BPJS_CONS_ID: '10000',
    BPJS_SECRET_KEY: 'mock-secret',
    BPJS_USER_KEY: 'mock-user-key',
    INTEGRATION_MODE: 'mock',
  });
  A = await seededTenant();
  B = await seededTenant();
  for (const [who, t, role] of [
    ['daftar', A, 'petugas_pendaftaran'],
    ['perawat', A, 'perawat'],
    ['dokterLain', A, 'dokter'],
    ['rsB', B, 'petugas_pendaftaran'],
  ] as const) {
    tok[who] = await login(app, await createTestUser(t.id, { roles: [{ code: role }], tenantCode: t.code }));
  }
  // dr. Andini punya akun dokter: registrasi memberi relasi DPJP ke pasiennya.
  const dokter = await createTestUser(A.id, { roles: [{ code: 'dokter' }], tenantCode: A.code });
  dokterUserId = dokter.id;
  tok.dpjp = await login(app, dokter);
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, A.id, (tx) =>
      tx.practitioner.updateMany({
        where: { name: 'dr. Andini Prameswari, Sp.PD' },
        data: { userId: dokter.id },
      }),
    );
  } finally {
    await owner.$disconnect();
  }
});

afterAll(async () => {
  await app?.close();
  await mock?.close();
});

beforeEach(() => mockState.reset());

describe('registrasi rawat jalan', () => {
  it('BPJS walk-in: 201 kunjungan RJ + booking JKN check-in + tiket poli + SEP pending (outbox) + DPJP + task 1/3', async () => {
    const s = await todaySession(A.id);
    const p = await makePatient(A.id);
    // BPJS sedang gangguan: registrasi tidak memanggil BPJS, jadi tetap berhasil (DoD "gangguan BPJS").
    mockState.scenarios.set('bpjs', { ...mockState.scenario('bpjs'), mode: 'gagal' });
    const res = await register('daftar', {
      patientId: p.id,
      sessionId: s.id,
      coverage: bpjsCoverage(p.card, { note: 'Kontrol hipertensi' }),
      generalConsent: CONSENT,
      guarantor: { name: 'Budi Fiktif', relation: 'suami', phone: '0812-3456-7890' },
    }).expect(201);
    const r = res.body;
    expect(r.encounter).toMatchObject({
      class: 'AMB',
      status: 'arrived',
      patientId: p.id,
      serviceId: s.serviceId,
      poliCode: 'PD',
    });
    expect(r.encounter.number).toMatch(/^RJ-\d{4}-\d{6}$/);
    expect(r.coverage).toMatchObject({ payerKind: 'bpjs', priority: 1, locked: false, status: 'active' });
    expect(r.coverage.memberNoMasked).not.toContain(p.card);
    expect(r.sep).toMatchObject({
      status: 'pending',
      version: 1,
      sepNo: null,
      bpjsPoliCode: 'INT',
      initialDiagnosis: DIAG,
      sync: { status: 'pending', sentAt: null, error: null },
    });
    expect(r.queueTicket).toMatchObject({ serviceCode: 'PD', reserved: false, encounterId: r.encounter.id });
    expect(r.appointment.bookingCode).toMatch(/^\d{10}$/);

    const appt = await run(A.id, (tx) =>
      tx.appointment.findUniqueOrThrow({ where: { id: r.appointment.id } }),
    );
    expect(appt).toMatchObject({ status: 'checked_in', quotaBucket: 'jkn', channel: 'loket' });
    expect(await outboxKeys(A.id, 'bpjs.vclaim.sep.insert')).toContain(
      outboxKey('bpjs.vclaim.sep.insert', r.sep.id, 1),
    );
    expect(await outboxKeys(A.id, 'bpjs.antrean.add')).toContain(outboxKey('bpjs.antrean.add', appt.id));
    const tasks = await run(A.id, (tx) =>
      tx.bpjsQueueTask.findMany({ where: { appointmentId: appt.id }, orderBy: { taskId: 'asc' } }),
    );
    // Walk-in tanpa tiket loket: check-in (1), layanan admisi = saat didaftarkan (2), tunggu poli (3); BPJS menolak 1 → 3.
    expect(tasks.map((t) => t.taskId)).toEqual([1, 2, 3]);
    expect(tasks[1]?.occurredAt.getTime()).toBe(tasks[2]?.occurredAt.getTime());
    const events = await run(A.id, (tx) =>
      tx.domainEvent.findMany({
        where: { name: 'encounter.registered', payload: { path: ['encounterId'], equals: r.encounter.id } },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      encounterClass: 'amb',
      payer: 'bpjs',
      appointmentId: appt.id,
    });

    // Persetujuan umum rawat jalan (tanpa kunjungan = sampai dicabut), kontak penanggung jawab, relasi DPJP.
    const consent = await run(A.id, (tx) =>
      tx.privacyConsent.findMany({ where: { patientId: p.id, kind: 'umum', revokedAt: null } }),
    );
    expect(consent).toHaveLength(1);
    expect(consent[0]?.encounterId).toBeNull();
    const contacts = await as('daftar').get(`/patients/${p.id}/contacts`).expect(200);
    expect(contacts.body).toEqual([
      expect.objectContaining({
        name: 'Budi Fiktif',
        relation: 'suami',
        isGuarantor: true,
        phoneMasked: expect.any(String),
      }),
    ]);
    expect(contacts.body[0].phoneMasked).not.toContain('3456');
    const rel = await run(A.id, (tx) =>
      tx.accessRelationship.findMany({ where: { patientId: p.id, userId: dokterUserId } }),
    );
    expect(rel).toEqual([
      expect.objectContaining({ kind: 'dpjp', sourceType: 'encounter', sourceId: r.encounter.id }),
    ]);

    // Audit `create` per pasien, tanpa nilai identitas.
    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findMany({ where: { resourceType: 'encounter', resourceId: r.encounter.id } }),
    );
    expect(audit.map((a) => [a.action, a.patientId])).toContainEqual(['create', p.id]);
    expect(jsonText(audit)).not.toContain(p.card);
  });

  it('Idempotency-Key: wajib UUID; ulang = hasil sama tanpa kunjungan kedua; isi beda = 409; serentak = satu kunjungan', async () => {
    const s = await todaySession(A.id);
    const p = await makePatient(A.id, { jkn: false });
    const body = { patientId: p.id, sessionId: s.id, coverage: { payer: 'umum' }, generalConsent: CONSENT };
    expect((await as('daftar').post('/registration/outpatient', body).expect(400)).body.code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    expect((await register('daftar', body, 'bukan-uuid').expect(400)).body.code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );

    const key = newId();
    const [r1, r2] = await Promise.all([register('daftar', body, key), register('daftar', body, key)]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r1.body.encounter.id).toBe(r2.body.encounter.id);
    const r3 = await register('daftar', body, key).expect(201);
    // Sama persis kecuali perkiraan panggil tiket (dihitung saat dibaca).
    const { queueTicket: t3, ...rest3 } = r3.body;
    const { queueTicket: t1, ...rest1 } = r1.body;
    expect(rest3).toEqual(rest1);
    expect({ ...t3, estimatedCallAt: null }).toEqual({ ...t1, estimatedCallAt: null });
    const encounters = await run(A.id, (tx) => tx.encounter.count({ where: { patientId: p.id } }));
    expect(encounters).toBe(1);

    const other = await register(
      'daftar',
      { ...body, coverage: { payer: 'umum' }, guarantor: { contactId: newId() } },
      key,
    ).expect(409);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // Kunci baru untuk pasien yang sudah terdaftar di poli yang sama hari ini → kunjungan ganda ditolak.
    expect((await register('daftar', body).expect(409)).body.code).toBe('ENCOUNTER_DUPLICATE');
  });

  it('persetujuan umum wajib sekali (rawat jalan berlaku sampai dicabut); booking dibawa → nomor poli booking, tiket loket ditautkan', async () => {
    const s = await todaySession(A.id);
    const p = await makePatient(A.id, { jkn: false });
    const noConsent = await register('daftar', {
      patientId: p.id,
      sessionId: s.id,
      coverage: { payer: 'umum' },
    }).expect(422);
    expect(noConsent.body.code).toBe('GENERAL_CONSENT_REQUIRED');

    // Booking non-JKN hari ini + tiket loket dari anjungan/loket.
    const booking = await as('daftar')
      .post('/booking/appointments', { patientId: p.id, sessionId: s.id, quotaBucket: 'non_jkn' })
      .expect(201);
    const counter = await run(A.id, (tx) => tx.queueService.findFirstOrThrow({ where: { code: 'A' } }));
    const ticket = await as('daftar').post(`/queue/services/${counter.id}/tickets`, {}).expect(201);
    const asuransi = await run(A.id, (tx) => tx.payer.findFirstOrThrow({ where: { kind: 'asuransi' } }));
    const res = await register('daftar', {
      patientId: p.id,
      sessionId: s.id,
      appointmentId: booking.body.id,
      counterTicketId: ticket.body.id,
      coverage: {
        payer: 'asuransi',
        payerId: asuransi.id,
        memberNo: 'ASR-123456789',
        guaranteeLetterNo: 'SJ-01',
      },
      generalConsent: { confirmedByStaff: true, signer: 'wali', signerName: 'Wali Fiktif' },
    }).expect(201);
    expect(res.body.appointment).toEqual({ id: booking.body.id, bookingCode: booking.body.bookingCode });
    expect(res.body.queueTicket.queueNo).toBe(booking.body.queueNo);
    expect(res.body.sep).toBeNull();
    expect(res.body.coverage).toMatchObject({
      payerKind: 'asuransi',
      memberNoMasked: expect.stringMatching(/6789$/),
    });
    expect(res.body.coverage.memberNoMasked).not.toContain('12345');
    const t = await run(A.id, (tx) => tx.queueTicket.findUniqueOrThrow({ where: { id: ticket.body.id } }));
    expect(t.appointmentId).toBe(booking.body.id);

    // Pasien yang sama di sesi lain: persetujuan sudah ada → tidak wajib lagi.
    const s2 = await todaySession(A.id);
    await run(A.id, (tx) =>
      tx.encounter.updateMany({
        where: { patientId: p.id },
        data: { status: 'cancelled', cancelReason: 'uji ulang' },
      }),
    );
    await run(A.id, (tx) =>
      tx.appointment.update({
        where: { id: booking.body.id },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Uji ulang registrasi' },
      }),
    );
    await register('daftar', { patientId: p.id, sessionId: s2.id, coverage: { payer: 'umum' } }).expect(201);
    expect(
      await run(A.id, (tx) =>
        tx.privacyConsent.count({ where: { patientId: p.id, kind: 'umum', revokedAt: null } }),
      ),
    ).toBe(1);
  });

  it('validasi: BPJS tanpa kartu 422; sesi bukan hari ini 409; rujukan kedaluwarsa 422; pasien/sesi tak dikenal 404', async () => {
    const s = await todaySession(A.id);
    const noCard = await makePatient(A.id, { jkn: false });
    const res = await register('daftar', {
      patientId: noCard.id,
      sessionId: s.id,
      coverage: bpjsCoverage('0000123456781'),
      generalConsent: CONSENT,
    }).expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');

    const tomorrow = await withTenant(testDb(), A.id, async (tx) => {
      const sess = await tx.scheduleSession.findUniqueOrThrow({ where: { id: s.id } });
      const id = newId();
      await tx.scheduleSession.create({
        data: {
          ...sess,
          id,
          sessionDate: new Date(Date.parse(`${today}T00:00:00.000Z`) + 86_400_000),
          bookedJkn: 0,
          bookedNonJkn: 0,
          createdAt: undefined,
          updatedAt: undefined,
        },
      });
      return id;
    });
    const p = await makePatient(A.id);
    expect(
      (
        await register('daftar', {
          patientId: p.id,
          sessionId: tomorrow,
          coverage: bpjsCoverage(p.card),
          generalConsent: CONSENT,
        }).expect(409)
      ).body.code,
    ).toBe('SESSION_CLOSED');

    // Rujukan yang tercatat kedaluwarsa (hasil lookup sebelumnya).
    await run(A.id, (tx) =>
      tx.referral.create({
        data: {
          id: newId(),
          tenantId: A.id,
          patientId: p.id,
          kind: 'rujukan-fktp',
          number: rujukanNo(p.card, '99'),
          facilityName: 'FKTP Fiktif',
          issuedOn: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2026-04-01T00:00:00.000Z'),
          status: 'expired',
        },
      }),
    );
    expect(
      (
        await register('daftar', {
          patientId: p.id,
          sessionId: s.id,
          coverage: bpjsCoverage(p.card, { referenceNumber: rujukanNo(p.card, '99') }),
          generalConsent: CONSENT,
        }).expect(422)
      ).body.code,
    ).toBe('REFERRAL_EXPIRED');
    await register('daftar', { patientId: newId(), sessionId: s.id, coverage: { payer: 'umum' } }).expect(
      404,
    );
    await register('daftar', { patientId: p.id, sessionId: newId(), coverage: { payer: 'umum' } }).expect(
      404,
    );
  });
});

describe('SEP: mesin keadaan', () => {
  async function registered() {
    const s = await todaySession(A.id);
    const p = await makePatient(A.id);
    const r = (
      await register('daftar', {
        patientId: p.id,
        sessionId: s.id,
        coverage: bpjsCoverage(p.card),
        generalConsent: CONSENT,
      }).expect(201)
    ).body;
    return { p, r, sepId: r.sep.id as string, coverageId: r.coverage.id as string };
  }
  /** Hasil worker: SEP terbit (kolom yang sama dengan yang ditulis worker). */
  const issue = (sepId: string, sepNo: string) =>
    run(A.id, (tx) =>
      tx.sep.update({
        where: { id: sepId },
        data: { status: 'issued', sepNo, issuedAt: new Date(), syncStatus: 'sent', syncedAt: new Date() },
      }),
    );
  const sepNo = () => `0301R0011026V${uniqueDigits(6)}`;

  it('pending: tidak bisa batal/revisi/kirim ulang; terbit: penjaminan terkunci (database menolak ubah)', async () => {
    const { r, sepId, coverageId } = await registered();
    expect(
      (await as('daftar').post(`/sep/${sepId}/cancel`, { reason: 'Salah poli tujuan' }).expect(409)).body
        .code,
    ).toBe('SEP_STATE_INVALID');
    expect(
      (await as('daftar').patch(`/sep/${sepId}`, { note: 'x', reason: 'Koreksi catatan SEP' }).expect(409))
        .body.code,
    ).toBe('SEP_STATE_INVALID');
    expect((await as('daftar').post(`/sep/${sepId}/retry`).expect(409)).body.code).toBe('SEP_STATE_INVALID');
    // Izin `coverage.*` dan isolasi tenant.
    await as('perawat').get(`/sep/${sepId}`).expect(403);
    await as('perawat').post(`/sep/${sepId}/retry`).expect(403);
    await as('rsB').get(`/sep/${sepId}`).expect(404);
    await as('rsB').post(`/sep/${sepId}/cancel`, { reason: 'Batal dari RS lain' }).expect(404);

    await issue(sepId, sepNo());
    const enc = await as('daftar').get(`/registration/encounters/${r.encounter.id}`).expect(200);
    expect(enc.body.coverage.locked).toBe(true);
    expect(enc.body.sep).toMatchObject({ status: 'issued', sync: { status: 'sent' } });
    await expect(
      run(A.id, (tx) => tx.coverage.update({ where: { id: coverageId }, data: { careClass: 'vip' } })),
    ).rejects.toThrow(/COVERAGE_LOCKED/);
    // SEP terbit beku: isi tidak bisa diubah langsung.
    await expect(
      run(A.id, (tx) => tx.sep.update({ where: { id: sepId }, data: { lastErrorCode: 'X_UJI' } })),
    ).rejects.toThrow(/SEP_FROZEN/);
  });

  it('revisi = versi baru pending + outbox update; versi lama tidak bisa ditindak; batal versi terbaru → outbox delete', async () => {
    const { p, sepId } = await registered();
    const no = sepNo();
    await issue(sepId, no);
    const revised = await as('daftar')
      .patch(`/sep/${sepId}`, {
        initialDiagnosis: { code: 'E11.9', display: 'Diabetes melitus tipe 2' },
        reason: 'Koreksi diagnosa awal',
      })
      .expect(200);
    expect(revised.body).toMatchObject({
      version: 2,
      supersedesId: sepId,
      status: 'pending',
      sepNo: no,
      correctionReason: 'Koreksi diagnosa awal',
      initialDiagnosis: { code: 'E11.9' },
    });
    expect(await outboxKeys(A.id, 'bpjs.vclaim.sep.update')).toContain(
      outboxKey('bpjs.vclaim.sep.update', revised.body.id, 1),
    );
    await as('daftar').patch(`/sep/${sepId}`, { note: 'lagi', reason: 'Koreksi kedua kali' }).expect(409);
    await as('daftar').post(`/sep/${sepId}/cancel`, { reason: 'Batal versi lama' }).expect(409);

    await issue(revised.body.id, no);
    const cancelled = await as('daftar')
      .post(`/sep/${revised.body.id}/cancel`, { reason: 'Pasien pulang tanpa dilayani' })
      .expect(200);
    expect(cancelled.body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Pasien pulang tanpa dilayani',
      sync: { status: 'pending' },
    });
    expect(await outboxKeys(A.id, 'bpjs.vclaim.sep.delete')).toContain(
      outboxKey('bpjs.vclaim.sep.delete', revised.body.id, 2),
    );
    const audits = await run(A.id, (tx) =>
      tx.auditEvent.findMany({ where: { resourceType: 'sep', patientId: p.id, action: 'update' } }),
    );
    expect(audits.map((a) => a.reason)).toEqual(
      expect.arrayContaining(['Koreksi diagnosa awal', 'Pasien pulang tanpa dilayani']),
    );
  });

  it('gagal (ditolak/DLQ) → kirim ulang: pending lagi dengan kunci outbox urut berikutnya', async () => {
    const { sepId } = await registered();
    await run(A.id, (tx) =>
      tx.sep.update({
        where: { id: sepId },
        data: {
          status: 'failed',
          lastErrorCode: 'BPJS_RUJUKAN_TIDAK_DITEMUKAN',
          rejectionReason: 'Rujukan tidak ditemukan',
          syncStatus: 'rejected',
          syncErrorCode: 'BPJS_RUJUKAN_TIDAK_DITEMUKAN',
        },
      }),
    );
    const got = await as('daftar').get(`/sep/${sepId}`).expect(200);
    expect(got.body).toMatchObject({
      status: 'failed',
      rejectionReason: 'Rujukan tidak ditemukan',
      sync: {
        status: 'rejected',
        error: { code: 'BPJS_RUJUKAN_TIDAK_DITEMUKAN', message: 'Rujukan tidak ditemukan' },
      },
    });
    const retried = await as('daftar').post(`/sep/${sepId}/retry`).expect(200);
    expect(retried.body).toMatchObject({
      status: 'pending',
      rejectionReason: null,
      lastErrorCode: null,
      sync: { status: 'pending', error: null },
    });
    expect(await outboxKeys(A.id, 'bpjs.vclaim.sep.insert')).toEqual(
      expect.arrayContaining([
        outboxKey('bpjs.vclaim.sep.insert', sepId, 1),
        outboxKey('bpjs.vclaim.sep.insert', sepId, 2),
      ]),
    );
  });
});

describe('lookup sinkron (mock BPJS/Dukcapil)', () => {
  it('kepesertaan: aktif/tidak aktif tersamar; tidak ditemukan 422 BPJS_REJECTED; mock gagal 503; audit dengan pasien', async () => {
    const p = await makePatient(A.id);
    const ok = await as('daftar')
      .post(`/sep/eligibility-checks?patientId=${p.id}`, { by: 'kartu', value: p.card })
      .expect(200);
    expect(ok.body.eligibility).toMatchObject({ status: 'aktif' });
    expect(ok.body.eligibility.cardMasked).not.toBe(p.card);
    const inactive = await makePatient(A.id, { inactive: true });
    expect(
      (await as('daftar').post('/sep/eligibility-checks', { by: 'kartu', value: inactive.card }).expect(200))
        .body.eligibility.status,
    ).toBe('tidak-aktif');
    const missing = await as('daftar')
      .post('/sep/eligibility-checks', { by: 'kartu', value: '0000123459999' })
      .expect(422);
    expect(missing.body).toMatchObject({
      code: 'BPJS_REJECTED',
      details: { reason: 'BPJS_PESERTA_TIDAK_DITEMUKAN' },
    });

    mockState.scenarios.set('bpjs', { ...mockState.scenario('bpjs'), mode: 'gagal' });
    expect(
      (await as('daftar').post('/sep/eligibility-checks', { by: 'kartu', value: p.card }).expect(503)).body
        .code,
    ).toBe('BPJS_UNAVAILABLE');

    const audit = await run(A.id, (tx) =>
      tx.auditEvent.findMany({ where: { resourceType: 'bpjs.vclaim.peserta', patientId: p.id } }),
    );
    expect(audit.map((a) => (a.details as { phase: string }).phase).sort()).toEqual([
      'completed',
      'requested',
    ]);
    expect(jsonText(audit)).not.toContain(p.card);
  });

  it('rujukan per pasien: FKTP dari VClaim disimpan (aktif + kedaluwarsa), lalu dipakai registrasi sebagai dasar SEP', async () => {
    const p = await makePatient(A.id);
    const res = await as('daftar').get(`/sep/referrals?patientId=${p.id}`).expect(200);
    const numbers: string[] = res.body.referrals.map((r: { number: string }) => r.number);
    const activeNo = numbers.find((n) => n.endsWith(`${p.card.slice(-9)}01`));
    const expiredNo = numbers.find((n) => n.endsWith(`${p.card.slice(-9)}99`));
    expect(activeNo && expiredNo).toBeTruthy();
    const active = res.body.referrals.find((r: { number: string }) => r.number === activeNo);
    expect(active).toMatchObject({ kind: 'rujukan-fktp', poliCode: 'PD', diagnosis: { code: 'I10' } });
    const stored = await run(A.id, (tx) =>
      tx.referral.findMany({ where: { patientId: p.id }, orderBy: { number: 'asc' } }),
    );
    expect(stored.map((r) => r.status)).toEqual(['active', 'expired']);

    const s = await todaySession(A.id);
    const reg = await register('daftar', {
      patientId: p.id,
      sessionId: s.id,
      coverage: bpjsCoverage(p.card, { referenceNumber: activeNo }),
      generalConsent: CONSENT,
    }).expect(201);
    expect(reg.body.sep.referralId).toBe(stored[0]?.id);
    const other = await makePatient(A.id);
    expect(
      (
        await register('daftar', {
          patientId: other.id,
          sessionId: s.id,
          coverage: bpjsCoverage(other.card, { referenceNumber: activeNo }),
          generalConsent: CONSENT,
        }).expect(422)
      ).body.message,
    ).toMatch(/pasien lain/);
  });

  it('Dukcapil: ditemukan → isian demografi; tidak ditemukan → found false; mock gagal → 503', async () => {
    const found = await as('daftar')
      .post('/registration/dukcapil-lookup', { nik: '9999010190012345' })
      .expect(200);
    expect(found.body).toMatchObject({ found: true, sex: expect.stringMatching(/male|female/) });
    expect(found.body.birthDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      (await as('daftar').post('/registration/dukcapil-lookup', { nik: '9999010190019999' }).expect(200))
        .body,
    ).toEqual({ found: false });
    mockState.scenarios.set('dukcapil', { ...mockState.scenario('dukcapil'), mode: 'gagal' });
    expect(
      (await as('daftar').post('/registration/dukcapil-lookup', { nik: '9999010190012345' }).expect(503)).body
        .code,
    ).toBe('INTEGRATION_UNAVAILABLE');
    await as('perawat').post('/registration/dukcapil-lookup', { nik: '9999010190012345' }).expect(403);
  });
});

describe('meja, izin, ABAC, isolasi', () => {
  it('meja pendaftaran: antrean loket + kuota dokter hari ini', async () => {
    const s = await todaySession(A.id);
    const res = await as('daftar').get('/registration/desk').expect(200);
    expect(res.body.date).toBe(today);
    expect(res.body.counter.name).toBeTruthy();
    expect(res.body.quotas.map((q: { sessionId: string }) => q.sessionId)).toContain(s.id);
  });

  it('DPJP berelasi boleh membaca kunjungan; dokter lain 403 (diaudit); perawat tidak boleh mendaftar; RS lain 404', async () => {
    const s = await todaySession(A.id);
    const p = await makePatient(A.id, { jkn: false });
    const r = (
      await register('daftar', {
        patientId: p.id,
        sessionId: s.id,
        coverage: { payer: 'umum' },
        generalConsent: CONSENT,
      }).expect(201)
    ).body;
    await as('dpjp').get(`/registration/encounters/${r.encounter.id}`).expect(200);
    const denied = await as('dokterLain').get(`/registration/encounters/${r.encounter.id}`).expect(403);
    expect(denied.body.details).toMatchObject({ breakGlassAvailable: true });
    await register('perawat', { patientId: p.id, sessionId: s.id, coverage: { payer: 'umum' } }).expect(403);
    await as('perawat')
      .post(`/patients/${p.id}/contacts`, { name: 'Kontak Fiktif', relation: 'anak' })
      .expect(403);

    await as('rsB').get(`/registration/encounters/${r.encounter.id}`).expect(404);
    await as('rsB').get(`/patients/${p.id}/contacts`).expect(404);
    const pb = await makePatient(B.id, { jkn: false });
    // RS B tidak bisa mendaftarkan pasiennya ke sesi RS A.
    await register('rsB', {
      patientId: pb.id,
      sessionId: s.id,
      coverage: { payer: 'umum' },
      generalConsent: CONSENT,
    }).expect(404);
    const read = await run(A.id, (tx) =>
      tx.auditEvent.findMany({
        where: { resourceType: 'encounter', resourceId: r.encounter.id, action: 'read' },
      }),
    );
    expect(read.every((a) => a.patientId === p.id)).toBe(true);
  });

  it('lembar cetak loket: tiket poli + ringkasan SEP (kartu tersamar), diaudit print; perawat 403; RS lain 404', async () => {
    const s = await todaySession(A.id);
    const p = await makePatient(A.id);
    const r = (
      await register('daftar', {
        patientId: p.id,
        sessionId: s.id,
        coverage: bpjsCoverage(p.card),
        generalConsent: CONSENT,
      }).expect(201)
    ).body;
    const res = await as('daftar').get(`/registration/encounters/${r.encounter.id}/print`).expect(200);
    expect(printableVisitSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({
      encounterNumber: r.encounter.number,
      serviceDate: today,
      patient: { name: 'Pasien Registrasi Fiktif' },
      queueNo: r.queueTicket.queueNo,
      bookingCode: r.appointment.bookingCode,
      payerKind: 'bpjs',
      practitionerName: 'dr. Andini Prameswari, Sp.PD',
      sep: { status: 'pending', sepNo: null, referenceNumber: rujukanNo(p.card), initialDiagnosis: DIAG },
    });
    expect(JSON.stringify(res.body)).not.toContain(p.card);
    const printed = await run(A.id, (tx) =>
      tx.auditEvent.findMany({
        where: { resourceType: 'encounter', resourceId: r.encounter.id, action: 'print' },
      }),
    );
    expect(printed).toHaveLength(1);
    expect(printed[0]?.patientId).toBe(p.id);
    await as('perawat').get(`/registration/encounters/${r.encounter.id}/print`).expect(403);
    await as('rsB').get(`/registration/encounters/${r.encounter.id}/print`).expect(404);
  });

  it('kontak penanggung jawab: tambah (append-only, terenkripsi) dan daftar', async () => {
    const p = await makePatient(A.id, { jkn: false });
    const created = await as('daftar')
      .post(`/patients/${p.id}/contacts`, {
        name: 'Siti Fiktif',
        relation: 'anak',
        phone: '081298765432',
        isGuarantor: false,
      })
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'Siti Fiktif',
      relation: 'anak',
      isGuarantor: false,
      active: true,
    });
    const row = await run(A.id, (tx) =>
      tx.patientContact.findUniqueOrThrow({ where: { id: created.body.id } }),
    );
    expect(row.nameEnc).not.toContain('Siti');
    expect((await as('daftar').get(`/patients/${p.id}/contacts`).expect(200)).body).toHaveLength(1);
    await as('daftar').post(`/patients/${p.id}/contacts`, { name: 'S', relation: 'anak' }).expect(400);
  });
});
