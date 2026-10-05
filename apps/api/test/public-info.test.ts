/**
 * F08 · Gateway informasi publik: tanpa login, tanpa PHI (kunci jawaban ditegaskan), RS tak dikenal/modul mati → 404,
 * status booking tahan enumerasi (404 seragam, audit tanpa PHI), isolasi tenant, dan batas laju.
 * RS fiktif baru per jalan tes (kode layanan antrean dan nomor tiket unik per RS).
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import { isoDateJakarta, newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createTestPatient, createTestTenant, jsonText, testDb } from './helpers';

interface Fixture {
  tenantId: string;
  code: string;
  bookingCode: string;
  appointmentId: string;
  patientId: string;
  mrn: string;
}

const today = isoDateJakarta();
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const PATIENT_NAME = 'Sulastri Rahasia Fiktif';
const BIRTH = '1972-03-14';

/** Satu RS fiktif: poli PD + loket A, dua sesi hari ini (praktik + cuti berpengganti), antrean, satu booking. */
async function seedTenant(): Promise<Fixture> {
  const t = await createTestTenant();
  const patient = await createTestPatient(t.id, { name: PATIENT_NAME, birthDate: BIRTH });
  const ids = {
    pd: newId(),
    loket: newId(),
    dr: newId(),
    sub: newId(),
    session: newId(),
    cuti: newId(),
    appt: newId(),
  };
  const bookingCode = `26${String(Date.now()).slice(-8)}`;
  await withTenant(testDb(), t.id, async (tx) => {
    await tx.queueService.createMany({
      data: [
        { id: ids.pd, tenantId: t.id, code: 'PD', name: 'Poli Penyakit Dalam', kind: 'poli' },
        { id: ids.loket, tenantId: t.id, code: 'A', name: 'Loket Pendaftaran', kind: 'loket' },
      ],
    });
    await tx.practitioner.createMany({
      data: [
        { id: ids.dr, tenantId: t.id, name: 'dr. Andini Fiktif, Sp.PD' },
        { id: ids.sub, tenantId: t.id, name: 'dr. Bayu Fiktif, Sp.PD' },
      ],
    });
    await tx.scheduleSession.createMany({
      data: [
        {
          id: ids.session,
          tenantId: t.id,
          practitionerId: ids.dr,
          serviceId: ids.pd,
          sessionDate: day(today),
          startTime: time('08:00'),
          endTime: time('12:00'),
          quotaJkn: 20,
          quotaNonJkn: 5,
          bookedJkn: 7,
          bookedNonJkn: 1,
        },
        {
          id: ids.cuti,
          tenantId: t.id,
          practitionerId: ids.sub,
          serviceId: ids.pd,
          sessionDate: day(today),
          startTime: time('13:00'),
          endTime: time('16:00'),
          kind: 'cuti',
          substituteId: ids.dr,
          quotaJkn: 10,
          quotaNonJkn: 5,
        },
      ],
    });
    await tx.appointment.create({
      data: {
        id: ids.appt,
        tenantId: t.id,
        bookingCode,
        patientId: patient.id,
        sessionId: ids.session,
        practitionerId: ids.dr,
        serviceId: ids.pd,
        appointmentDate: day(today),
        quotaBucket: 'non_jkn',
        channel: 'loket',
        estimatedAt: new Date('2026-10-05T02:30:00.000Z'),
      },
    });
    const ticket = (seq: number, status: string, extra: object = {}) => ({
      id: newId(),
      tenantId: t.id,
      serviceId: ids.pd,
      serviceDate: day(today),
      seq,
      ticketNo: `PD-${String(seq).padStart(3, '0')}`,
      source: 'loket',
      status,
      ...extra,
    });
    const tickets = [
      ticket(1, 'serving'),
      ticket(2, 'called'),
      ticket(3, 'waiting'),
      ticket(4, 'waiting'),
      ticket(5, 'waiting', {
        appointmentId: ids.appt,
        patientId: patient.id,
        source: 'booking',
        reserved: true,
      }),
    ];
    await tx.queueTicket.createMany({ data: tickets });
    await tx.queueCall.createMany({
      data: [
        {
          id: newId(),
          tenantId: t.id,
          ticketId: tickets[0]!.id,
          action: 'start',
          calledAt: new Date(Date.now() - 60_000),
        },
        {
          id: newId(),
          tenantId: t.id,
          ticketId: tickets[1]!.id,
          action: 'call',
          counter: 'Ruang 1',
          calledAt: new Date(),
        },
      ],
    });
  });
  return {
    tenantId: t.id,
    code: t.code,
    bookingCode,
    appointmentId: ids.appt,
    patientId: patient.id,
    mrn: patient.mrn,
  };
}

let app: NestExpressApplication;
let x: Fixture;
let y: Fixture;
const http = () => request(app.getHttpServer());

/** Teks jawaban tidak boleh memuat identitas pasien. */
function expectNoPhi(body: unknown, f: Fixture) {
  const text = JSON.stringify(body);
  for (const secret of [PATIENT_NAME, 'Sulastri', BIRTH, f.mrn, f.patientId])
    expect(text).not.toContain(secret);
}

const auditRows = (f: Fixture, requestId: string) =>
  withTenant(testDb(), f.tenantId, (tx) =>
    tx.auditEvent.findMany({ where: { requestId }, orderBy: { seq: 'asc' } }),
  );

beforeAll(async () => {
  app = await createTestApp();
  x = await seedTenant();
  y = await seedTenant();
});

afterAll(async () => {
  await app?.close();
});

describe('jadwal publik', () => {
  it('sisa kuota per sesi, cuti = 0 + pengganti; kunci jawaban persis kontrak, tanpa PHI', async () => {
    const res = await http().get(`/api/v1/public/${x.code.toLowerCase()}/schedules`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['asOf', 'date', 'sessions']);
    expect(res.body.date).toBe(today);
    expect(res.body.sessions).toEqual([
      {
        poliName: 'Poli Penyakit Dalam',
        practitionerName: 'dr. Andini Fiktif, Sp.PD',
        start: '08:00',
        end: '12:00',
        status: 'praktik',
        substituteName: null,
        remaining: { jkn: 13, nonJkn: 4 },
      },
      {
        poliName: 'Poli Penyakit Dalam',
        practitionerName: 'dr. Bayu Fiktif, Sp.PD',
        start: '13:00',
        end: '16:00',
        status: 'cuti',
        substituteName: 'dr. Andini Fiktif, Sp.PD',
        remaining: { jkn: 0, nonJkn: 0 },
      },
    ]);
    expect(res.headers['cache-control']).toBe('no-store');
    expectNoPhi(res.body, x);
  });

  it('tanggal di luar rentang (lampau / lewat batas booking) → 400; besok tanpa sesi → kosong', async () => {
    await http().get(`/api/v1/public/${x.code}/schedules?date=2000-01-01`).expect(400);
    await http().get(`/api/v1/public/${x.code}/schedules?date=2999-01-01`).expect(400);
    await http().get(`/api/v1/public/${x.code}/schedules?date=bukan-tanggal`).expect(400);
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const res = await http().get(`/api/v1/public/${x.code}/schedules?date=${tomorrow}`).expect(200);
    expect(res.body.sessions).toEqual([]);
  });
});

describe('antrean berjalan publik', () => {
  it('nomor dipanggil terakhir, jumlah menunggu, perkiraan menit; per layanan atau semua', async () => {
    const all = await http().get(`/api/v1/public/${x.code}/queues`).expect(200);
    expect(Object.keys(all.body).sort()).toEqual(['asOf', 'services']);
    expect(all.body.services).toEqual([
      { code: 'A', name: 'Loket Pendaftaran', current: null, waiting: 0, estimatedWaitMinutes: 0 },
      { code: 'PD', name: 'Poli Penyakit Dalam', current: 'PD-002', waiting: 3, estimatedWaitMinutes: 30 },
    ]);
    const one = await http().get(`/api/v1/public/${x.code}/queues/PD`).expect(200);
    expect(one.body.services).toHaveLength(1);
    expect(Object.keys(one.body.services[0]).sort()).toEqual([
      'code',
      'current',
      'estimatedWaitMinutes',
      'name',
      'waiting',
    ]);
    expectNoPhi(one.body, x);
    await http().get(`/api/v1/public/${x.code}/queues/ZZ`).expect(404);
    await http().get(`/api/v1/public/${x.code}/queues/pd1`).expect(400);
  });
});

describe('status booking publik', () => {
  const ask = (f: Fixture, body: object, requestId = newId()) =>
    http().post(`/api/v1/public/${f.code}/bookings/status`).set('X-Request-Id', requestId).send(body);

  it('kode + tanggal lahir cocok → status tanpa PHI; audit read dengan id pasien, tanpa kode/tanggal lahir', async () => {
    const requestId = newId();
    const res = await ask(x, { bookingCode: x.bookingCode, birthDate: BIRTH }, requestId).expect(200);
    expect(res.body).toEqual({
      bookingCode: x.bookingCode,
      status: 'booked',
      serviceDate: today,
      start: '08:00',
      poliName: 'Poli Penyakit Dalam',
      practitionerName: 'dr. Andini Fiktif, Sp.PD',
      queueNo: 'PD-005',
      currentQueueNo: 'PD-002',
      estimatedAt: '2026-10-05T02:30:00.000Z',
    });
    expectNoPhi(res.body, x);
    const rows = await auditRows(x, requestId);
    expect(
      rows.map((r) => [r.action, r.outcome, r.resourceType, r.resourceId, r.patientId, r.details]),
    ).toEqual([
      ['read', 'success', 'appointment', x.appointmentId, x.patientId, { channel: 'public_gateway' }],
    ]);
    expect(jsonText(rows)).not.toContain(x.bookingCode);
    expect(jsonText(rows)).not.toContain(BIRTH);
  });

  it('tanggal lahir salah, kode tidak ada, dan kode RS lain → 404 BOOKING_NOT_FOUND yang sama; tercatat denied', async () => {
    const bodies: unknown[] = [];
    const attempts: Array<[Fixture, object, string]> = [
      [x, { bookingCode: x.bookingCode, birthDate: '1972-03-15' }, 'birth_date_mismatch'],
      [x, { bookingCode: '9999999999', birthDate: BIRTH }, 'not_found'],
      [y, { bookingCode: x.bookingCode, birthDate: BIRTH }, 'not_found'],
    ];
    for (const [f, body, reason] of attempts) {
      const requestId = newId();
      const res = await ask(f, body, requestId).expect(404);
      const { requestId: _ignored, ...rest } = res.body as { requestId: string };
      bodies.push(rest);
      const rows = await auditRows(f, requestId);
      expect(
        rows.map((r) => [r.action, r.outcome, r.patientId, (r.details as { reason: string }).reason]),
      ).toEqual([['read', 'denied', null, reason]]);
      expect(jsonText(rows)).not.toContain(BIRTH);
    }
    expect(bodies).toEqual([
      { code: 'BOOKING_NOT_FOUND', message: 'Booking tidak ditemukan' },
      { code: 'BOOKING_NOT_FOUND', message: 'Booking tidak ditemukan' },
      { code: 'BOOKING_NOT_FOUND', message: 'Booking tidak ditemukan' },
    ]);
  });

  it('data hanya di body: GET dan field tambahan ditolak; format salah → 400', async () => {
    await http().get(`/api/v1/public/${x.code}/bookings/status?bookingCode=${x.bookingCode}`).expect(404);
    await ask(x, { bookingCode: x.bookingCode, birthDate: BIRTH, nik: '3174000000000001' }).expect(400);
    await ask(x, { bookingCode: '123', birthDate: BIRTH }).expect(400);
  });
});

describe('RS dan isolasi', () => {
  it('RS tidak dikenal, kode RS tidak sah, atau modul F08 mati → 404 seragam', async () => {
    for (const path of ['schedules', 'queues']) {
      const res = await http().get(`/api/v1/public/TIDAKADA9/${path}`).expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
      await http().get(`/api/v1/public/r%27s/${path}`).expect(404);
    }
    await http()
      .post('/api/v1/public/TIDAKADA9/bookings/status')
      .send({ bookingCode: x.bookingCode, birthDate: BIRTH })
      .expect(404);

    const off = await createTestTenant();
    await withTenant(testDb(), off.id, (tx) =>
      tx.tenantModule.create({ data: { tenantId: off.id, moduleCode: 'F08', enabled: false } }),
    );
    const res = await http().get(`/api/v1/public/${off.code}/schedules`).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('jadwal dan antrean RS lain tidak terlihat', async () => {
    const other = await createTestTenant();
    const sched = await http().get(`/api/v1/public/${other.code}/schedules`).expect(200);
    expect(sched.body.sessions).toEqual([]);
    const queues = await http().get(`/api/v1/public/${other.code}/queues`).expect(200);
    expect(queues.body.services).toEqual([]);
    // RS y punya data sendiri yang sama bentuknya; nomor x tidak ikut.
    const qy = await http().get(`/api/v1/public/${y.code}/queues/PD`).expect(200);
    expect(qy.body.services[0].waiting).toBe(3);
  });
});

describe('batas laju', () => {
  it('jadwal/antrean: throttler public per IP; status booking: batas endpoint kredensial', async () => {
    const limited = await createTestApp({ PUBLIC_RATE_LIMIT_PER_MIN: '2', AUTH_RATE_LIMIT_PER_MIN: '2' });
    try {
      const get = () => request(limited.getHttpServer()).get(`/api/v1/public/${x.code}/schedules`);
      expect([(await get()).status, (await get()).status, (await get()).status]).toEqual([200, 200, 429]);
      const post = () =>
        request(limited.getHttpServer())
          .post(`/api/v1/public/${x.code}/bookings/status`)
          .send({ bookingCode: '9999999999', birthDate: BIRTH });
      expect([(await post()).status, (await post()).status, (await post()).status]).toEqual([404, 404, 429]);
    } finally {
      await limited.close();
    }
  });
});
