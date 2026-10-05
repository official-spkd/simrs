/**
 * F02 · Booking lewat API (fase 2 potongan 3): buat (kuota atomik, kode booking harian, nomor poli cadangan, outbox
 * Antrean BPJS untuk JKN), booking serentak di sisa kuota terakhir, ganda, batal (kuota kembali, batal BPJS,
 * event), jadwal ulang, check-in (tiket loket + event), audit per pasien, izin, dan isolasi tenant.
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

const DAY = 86_400_000;
const today = isoDateJakarta(new Date());
const plusDays = (n: number) => isoDateJakarta(new Date(Date.now() + n * DAY));
let digitSeed = 0;
/** Angka unik untuk identitas fiktif (no. kartu 0000…, NIK 9999…). */
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

/** Sesi praktik dr. Andini di poli PD pada tanggal tertentu (tanggal unik per pemanggilan bila `date` kosong). */
let sessionOffset = 0;
async function makeSession(
  tenantId: string,
  opts: {
    date?: string;
    quotaJkn?: number;
    quotaNonJkn?: number;
    bookedNonJkn?: number;
    start?: string;
  } = {},
) {
  return withTenant(testDb(), tenantId, async (tx) => {
    const service = await tx.queueService.findFirstOrThrow({ where: { code: 'PD' } });
    const practitioner = await tx.practitioner.findFirstOrThrow({
      where: { name: 'dr. Andini Prameswari, Sp.PD' },
    });
    sessionOffset += 1;
    const date = opts.date ?? plusDays(1 + (sessionOffset % 20));
    // Jam mulai unik per pemanggilan (kunci unik praktisi × tanggal × jam mulai).
    const start =
      opts.start ??
      `${String(6 + Math.floor(sessionOffset / 20)).padStart(2, '0')}:${String(sessionOffset % 60).padStart(2, '0')}`;
    const id = newId();
    await tx.scheduleSession.create({
      data: {
        id,
        tenantId,
        practitionerId: practitioner.id,
        serviceId: service.id,
        sessionDate: new Date(`${date}T00:00:00.000Z`),
        startTime: new Date(`1970-01-01T${start}:00.000Z`),
        endTime: new Date('1970-01-01T23:00:00.000Z'),
        quotaJkn: opts.quotaJkn ?? 10,
        quotaNonJkn: opts.quotaNonJkn ?? 5,
        bookedNonJkn: opts.bookedNonJkn ?? 0,
      },
    });
    return { id, date };
  });
}

async function makePatient(tenantId: string, opts: { jkn?: boolean } = {}) {
  return createTestPatient(tenantId, {
    name: 'Pasien Booking Fiktif',
    phone: `62812${uniqueDigits(8)}`,
    identifiers:
      opts.jkn === false
        ? { nik: `99990101900${uniqueDigits(5)}` }
        : { nik: `99990101900${uniqueDigits(5)}`, bpjs: `0000${uniqueDigits(8)}1` },
  });
}

const as = (who: string) => {
  const auth = () => bearer(tok[who] as Tokens);
  return {
    get: (url: string) => http().get(`/api/v1/booking/appointments${url}`).set(auth()),
    post: (url: string, body: object = {}) =>
      http().post(`/api/v1/booking/appointments${url}`).set(auth()).send(body),
  };
};

const JKN = { visitKind: 'kontrol', referenceNumber: '0301R0011025K000117' };
const quota = (tenantId: string, sessionId: string) =>
  withTenant(testDb(), tenantId, (tx) =>
    tx.scheduleSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { bookedJkn: true, bookedNonJkn: true },
    }),
  );
const outbox = (tenantId: string, operation: string) =>
  withTenant(testDb(), tenantId, (tx) =>
    tx.outboxMessage.findMany({ where: { operation }, select: { idempotencyKey: true, payload: true } }),
  );
const events = (tenantId: string, name: string, appointmentId: string) =>
  withTenant(testDb(), tenantId, (tx) =>
    tx.domainEvent.findMany({ where: { name, payload: { path: ['appointmentId'], equals: appointmentId } } }),
  );

beforeAll(async () => {
  app = await createTestApp();
  A = await seededTenant();
  B = await seededTenant();
  for (const [who, t, role] of [
    ['daftar', A, 'petugas_pendaftaran'],
    ['perawat', A, 'perawat'],
    ['rsB', B, 'petugas_pendaftaran'],
  ] as const) {
    tok[who] = await login(app, await createTestUser(t.id, { roles: [{ code: role }], tenantCode: t.code }));
  }
});

afterAll(async () => {
  await app?.close();
});

describe('buat booking', () => {
  it('non-JKN: kode booking tanggal layanan, nomor poli cadangan + estimasi, kuota terpakai, tanpa BPJS, diaudit', async () => {
    const s = await makeSession(A.id, { start: '08:00' });
    const p = await makePatient(A.id);
    const res = await as('daftar')
      .post('', { patientId: p.id, sessionId: s.id, quotaBucket: 'non_jkn' })
      .expect(201);
    const b = res.body;
    expect(b.bookingCode).toMatch(new RegExp(`^${s.date.slice(2).replaceAll('-', '')}\\d{4}$`));
    expect(b).toMatchObject({
      status: 'booked',
      channel: 'loket',
      quotaBucket: 'non_jkn',
      patientId: p.id,
      serviceDate: s.date,
      start: '08:00',
      poliCode: 'PD',
      practitionerName: 'dr. Andini Prameswari, Sp.PD',
      jkn: null,
      bpjs: { status: 'not_required', sentAt: null, error: null },
    });
    expect(b.queueNo).toMatch(/^PD-\d{3}$/);
    expect(new Date(b.estimatedAt).toISOString()).toBe(new Date(`${s.date}T08:00:00+07:00`).toISOString());
    expect(await quota(A.id, s.id)).toEqual({ bookedJkn: 0, bookedNonJkn: 1 });
    expect((await outbox(A.id, 'bpjs.antrean.add')).map((m) => m.idempotencyKey)).not.toContain(
      outboxKey('bpjs.antrean.add', b.id),
    );
    const [audit] = await withTenant(testDb(), A.id, (tx) =>
      tx.auditEvent.findMany({ where: { resourceType: 'appointment', resourceId: b.id, action: 'create' } }),
    );
    expect(audit).toMatchObject({ patientId: p.id, details: { quotaBucket: 'non_jkn', sessionId: s.id } });
  });

  it('JKN: wajib rujukan/kontrol + kartu BPJS; outbox bpjs.antrean.add hanya berisi ID; status BPJS pending', async () => {
    const s = await makeSession(A.id);
    const p = await makePatient(A.id);
    await as('daftar').post('', { patientId: p.id, sessionId: s.id, quotaBucket: 'jkn' }).expect(400);
    const noCard = await makePatient(A.id, { jkn: false });
    const rejected = await as('daftar')
      .post('', { patientId: noCard.id, sessionId: s.id, quotaBucket: 'jkn', jkn: JKN })
      .expect(422);
    expect(rejected.body.code).toBe('VALIDATION_FAILED');

    const res = await as('daftar')
      .post('', { patientId: p.id, sessionId: s.id, quotaBucket: 'jkn', jkn: JKN })
      .expect(201);
    expect(res.body).toMatchObject({ jkn: JKN, bpjs: { status: 'pending', error: null } });
    const msgs = (await outbox(A.id, 'bpjs.antrean.add')).filter(
      (m) => m.idempotencyKey === outboxKey('bpjs.antrean.add', res.body.id),
    );
    expect(msgs).toEqual([
      { idempotencyKey: `bpjs.antrean.add:${res.body.id}`, payload: { appointmentId: res.body.id } },
    ]);
    expect(await quota(A.id, s.id)).toEqual({ bookedJkn: 1, bookedNonJkn: 0 });
  });

  it('booking ganda (pasien × poli × tanggal) 409; sesi lewat 409; di luar batas hari 422; sesi/pasien tak dikenal 404', async () => {
    const s = await makeSession(A.id);
    const p = await makePatient(A.id);
    await as('daftar').post('', { patientId: p.id, sessionId: s.id, quotaBucket: 'non_jkn' }).expect(201);
    const dup = await as('daftar')
      .post('', { patientId: p.id, sessionId: s.id, quotaBucket: 'non_jkn' })
      .expect(409);
    expect(dup.body.code).toBe('BOOKING_DUPLICATE');

    const past = await makeSession(A.id, { date: plusDays(-1) });
    expect(
      (
        await as('daftar')
          .post('', { patientId: p.id, sessionId: past.id, quotaBucket: 'non_jkn' })
          .expect(409)
      ).body.code,
    ).toBe('SESSION_CLOSED');
    const far = await makeSession(A.id, { date: plusDays(45) });
    expect(
      (
        await as('daftar')
          .post('', { patientId: p.id, sessionId: far.id, quotaBucket: 'non_jkn' })
          .expect(422)
      ).body.code,
    ).toBe('BOOKING_OUT_OF_RANGE');
    await as('daftar').post('', { patientId: p.id, sessionId: newId(), quotaBucket: 'non_jkn' }).expect(404);
    await as('daftar').post('', { patientId: newId(), sessionId: s.id, quotaBucket: 'non_jkn' }).expect(404);
  });

  it('booking serentak untuk satu sisa kuota → tepat satu berhasil, sisanya 409 QUOTA_FULL', async () => {
    const s = await makeSession(A.id, { quotaNonJkn: 3, bookedNonJkn: 2 });
    const patients = await Promise.all(Array.from({ length: 6 }, () => makePatient(A.id)));
    const results = await Promise.all(
      patients.map((p) =>
        as('daftar').post('', { patientId: p.id, sessionId: s.id, quotaBucket: 'non_jkn' }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'QUOTA_FULL')).toBe(true);
    expect(await quota(A.id, s.id)).toEqual({ bookedJkn: 0, bookedNonJkn: 3 });
  });
});

describe('batal, jadwal ulang, check-in', () => {
  it('batal: kuota kembali, nomor poli batal, batal Antrean BPJS diantrekan sekali, event booking.cancelled', async () => {
    const s = await makeSession(A.id);
    const p = await makePatient(A.id);
    const b = (
      await as('daftar')
        .post('', { patientId: p.id, sessionId: s.id, quotaBucket: 'jkn', jkn: JKN })
        .expect(201)
    ).body;
    await as('daftar').post(`/${b.id}/cancel`, { reason: 'x' }).expect(400);
    const res = await as('daftar')
      .post(`/${b.id}/cancel`, { reason: 'Pasien berhalangan hadir' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'cancelled', cancelReason: 'Pasien berhalangan hadir' });
    expect(await quota(A.id, s.id)).toEqual({ bookedJkn: 0, bookedNonJkn: 0 });
    const ticket = await withTenant(testDb(), A.id, (tx) =>
      tx.queueTicket.findFirstOrThrow({ where: { appointmentId: b.id } }),
    );
    expect(ticket.status).toBe('cancelled');
    const again = await as('daftar').post(`/${b.id}/cancel`, { reason: 'Batal kedua kali' }).expect(409);
    expect(again.body.code).toBe('BOOKING_STATE_INVALID');
    expect(
      (await outbox(A.id, 'bpjs.antrean.batal')).filter(
        (m) => m.idempotencyKey === outboxKey('bpjs.antrean.batal', b.id),
      ),
    ).toHaveLength(1);
    expect(await events(A.id, 'booking.cancelled', b.id)).toHaveLength(1);
    const [audit] = await withTenant(testDb(), A.id, (tx) =>
      tx.auditEvent.findMany({ where: { resourceType: 'appointment', resourceId: b.id, action: 'update' } }),
    );
    expect(audit).toMatchObject({ patientId: p.id, reason: 'Pasien berhalangan hadir' });
  });

  it('jadwal ulang = batal + booking baru (kode baru) di sesi lain, kuota berpindah; sesi sama ditolak', async () => {
    const s1 = await makeSession(A.id);
    const s2 = await makeSession(A.id);
    const p = await makePatient(A.id);
    const b = (await as('daftar').post('', { patientId: p.id, sessionId: s1.id, quotaBucket: 'non_jkn' }))
      .body;
    await as('daftar').post(`/${b.id}/reschedule`, { sessionId: s1.id, reason: 'Pindah jadwal' }).expect(409);
    const res = await as('daftar')
      .post(`/${b.id}/reschedule`, { sessionId: s2.id, reason: 'Pasien minta hari lain' })
      .expect(200);
    expect(res.body.cancelled).toMatchObject({ id: b.id, status: 'cancelled' });
    expect(res.body.booking).toMatchObject({ status: 'booked', sessionId: s2.id, patientId: p.id });
    expect(res.body.booking.bookingCode).not.toBe(b.bookingCode);
    expect(await quota(A.id, s1.id)).toEqual({ bookedJkn: 0, bookedNonJkn: 0 });
    expect(await quota(A.id, s2.id)).toEqual({ bookedJkn: 0, bookedNonJkn: 1 });
  });

  it('check-in hari layanan: JKN dapat tiket loket A, event booking.checked_in; bukan hari layanan / ulang → 409', async () => {
    const s = await makeSession(A.id, { date: today });
    const p = await makePatient(A.id);
    const b = (
      await as('daftar')
        .post('', { patientId: p.id, sessionId: s.id, quotaBucket: 'jkn', jkn: JKN })
        .expect(201)
    ).body;
    const res = await as('daftar').post(`/${b.id}/check-in`).expect(200);
    expect(res.body.booking).toMatchObject({ status: 'checked_in' });
    expect(res.body.counterTicket).toMatchObject({
      serviceCode: 'A',
      source: 'loket',
      status: 'waiting',
      appointmentId: b.id,
      reserved: false,
    });
    expect(res.body.counterTicket.queueNo).toMatch(/^A-\d{3}$/);
    expect(await events(A.id, 'booking.checked_in', b.id)).toHaveLength(1);
    expect((await as('daftar').post(`/${b.id}/check-in`).expect(409)).body.code).toBe(
      'BOOKING_STATE_INVALID',
    );

    const later = await makeSession(A.id);
    const q = await makePatient(A.id);
    const nb = (await as('daftar').post('', { patientId: q.id, sessionId: later.id, quotaBucket: 'non_jkn' }))
      .body;
    expect((await as('daftar').post(`/${nb.id}/check-in`).expect(409)).body.code).toBe(
      'BOOKING_STATE_INVALID',
    );
  });
});

describe('baca, audit, izin, isolasi', () => {
  it('daftar per sesi diaudit per pasien; cari per kode; detail', async () => {
    const s = await makeSession(A.id);
    const [p1, p2] = await Promise.all([makePatient(A.id), makePatient(A.id)]);
    const b1 = (await as('daftar').post('', { patientId: p1.id, sessionId: s.id, quotaBucket: 'non_jkn' }))
      .body;
    await as('daftar').post('', { patientId: p2.id, sessionId: s.id, quotaBucket: 'non_jkn' }).expect(201);
    const list = await as('daftar').get(`?sessionId=${s.id}`).expect(200);
    expect(list.body.items.map((i: { patientId: string }) => i.patientId).sort()).toEqual(
      [p1.id, p2.id].sort(),
    );
    const searched = await withTenant(testDb(), A.id, (tx) =>
      tx.auditEvent.findMany({
        where: { resourceType: 'appointment', action: 'search', patientId: { in: [p1.id, p2.id] } },
      }),
    );
    expect(searched).toHaveLength(2);
    expect((await as('daftar').get(`/by-code/${b1.bookingCode}`).expect(200)).body.id).toBe(b1.id);
    expect((await as('daftar').get(`/${b1.id}`).expect(200)).body.bookingCode).toBe(b1.bookingCode);
    await as('daftar').get('/by-code/123').expect(400);
  });

  it('perawat tanpa izin booking → 403; RS lain tidak melihat booking RS ini', async () => {
    const s = await makeSession(A.id);
    const p = await makePatient(A.id);
    const b = (await as('daftar').post('', { patientId: p.id, sessionId: s.id, quotaBucket: 'non_jkn' }))
      .body;
    await as('perawat').get('').expect(403);
    await as('perawat').post('', { patientId: p.id, sessionId: s.id, quotaBucket: 'non_jkn' }).expect(403);
    await as('perawat').post(`/${b.id}/cancel`, { reason: 'Coba batal' }).expect(403);

    await as('rsB').get(`/${b.id}`).expect(404);
    await as('rsB').get(`/by-code/${b.bookingCode}`).expect(404);
    await as('rsB').post(`/${b.id}/cancel`, { reason: 'Coba batal dari RS lain' }).expect(404);
    const listB = await as('rsB').get(`?sessionId=${s.id}`).expect(200);
    expect(listB.body.items).toEqual([]);
    // RS B tidak bisa memesan sesi RS A.
    const pb = await makePatient(B.id);
    await as('rsB').post('', { patientId: pb.id, sessionId: s.id, quotaBucket: 'non_jkn' }).expect(404);
    expect(await quota(A.id, s.id)).toEqual({ bookedJkn: 0, bookedNonJkn: 1 });
  });
});
