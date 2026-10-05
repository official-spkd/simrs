/**
 * F05 · Anjungan mandiri (rencana fase 2 potongan 6): hanya prinsipal perangkat `kiosk.use`, identifikasi seragam
 * (nama tersamar + tanggal lahir tanpa tahun, tanpa ID pasien/RM/NIK), batas pencarian per perangkat, token sekali
 * pakai di perangkat yang sama, check-in → tiket loket A-xxx + task 1, tiket farmasi, cetak hanya tiket perangkat
 * sendiri, bantuan tanpa PHI, audit atas nama perangkat. Tenant fiktif baru dengan seed front office.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  allocateQueueNumber,
  createPrismaClient,
  type PrismaClient,
  seedFrontOffice,
  seedHospitalStructure,
  toDbDate,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import {
  isoDateJakarta,
  kioskIdentifyResultSchema,
  kioskSessionOptionSchema,
  newId,
  printableTicketSchema,
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
  jsonText,
  login,
  type Tokens,
  testDb,
} from './helpers';

let app: NestExpressApplication;
let owner: PrismaClient;
let T: { id: string; code: string };
let OTHER: { id: string; code: string };
const svc: Record<string, string> = {};
const unit: Record<string, string> = {};
let practitionerId: string;
let sessionId: string;
let admin: Tokens;
let otherAdmin: Tokens;
let registrar: Tokens;
let registrarId: string;
/**
 * Token perangkat (dv1): anjungan utama, anjungan kedua, TV, anjungan RS lain, dan anjungan RS lain khusus uji batas
 * laju (RS lain memakai batas bawaan 10/menit; RS uji dinaikkan ke 60 agar skenario lain tidak tertahan).
 */
const dev: Record<'kiosk' | 'kiosk2' | 'tv' | 'otherKiosk' | 'kioskRate', { id: string; token: string }> =
  {} as never;

const http = () => request(app.getHttpServer());
const run = <R>(fn: Parameters<typeof withTenant<R>>[2]) => withTenant(testDb(), T.id, fn);
const today = isoDateJakarta();
const asDevice = (token: string) => ({ Authorization: `Bearer ${token}` });
const nik = () => `99990154037${String(Math.floor(Math.random() * 100_000)).padStart(5, '0')}`;
const bpjsNo = () => `0000${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const bookingCode = () => String(Math.floor(Math.random() * 9e9) + 1e9);
const key = () => `kunci-${newId()}`;

async function enrolDevice(
  tokens: Tokens,
  tenantCode: string,
  kind: 'kiosk' | 'queue_display',
  unitId: string,
  name = 'Anjungan lobi uji',
) {
  const created = await http()
    .post('/api/v1/iam/devices')
    .set(bearer(tokens))
    .send({ kind, name, unitId })
    .expect(201);
  const res = await http()
    .post('/api/v1/devices/enrol')
    .send({ tenantCode, code: created.body.enrolmentCode })
    .expect(200);
  return { id: created.body.id as string, token: res.body.token as string };
}

/** Pasien fiktif dengan NIK + kartu BPJS fiktif, opsional booking hari ini (JKN/non-JKN). */
async function patient(opts: { booking?: 'jkn' | 'non_jkn'; name?: string; birthDate?: string } = {}) {
  const ids = { nik: nik(), bpjs: bpjsNo() };
  const p = await createTestPatient(T.id, {
    name: opts.name ?? 'Siti Rahmawati',
    birthDate: opts.birthDate ?? '1985-03-14',
    identifiers: ids,
  });
  let appointmentId: string | null = null;
  const code = bookingCode();
  /** No. surat kontrol fiktif unik (`referrals` unik per jenis + nomor). */
  const controlNo = `9999R0011025K${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
  if (opts.booking) {
    appointmentId = newId();
    const bucket = opts.booking;
    await run(async (tx) => {
      await tx.appointment.create({
        data: {
          id: appointmentId as string,
          tenantId: T.id,
          bookingCode: code,
          patientId: p.id,
          sessionId,
          practitionerId,
          serviceId: svc.PD as string,
          appointmentDate: toDbDate(today),
          quotaBucket: bucket,
          channel: 'mobile_jkn',
          ...(bucket === 'jkn' ? { jknVisitKind: 3, referenceNumber: controlNo } : {}),
        },
      });
      // Nomor poli cadangan booking, seperti `BookingService` (dilepas ke antrean saat registrasi).
      const n = await allocateQueueNumber(tx, T.id, svc.PD as string, today);
      await tx.queueTicket.create({
        data: {
          id: newId(),
          tenantId: T.id,
          serviceId: svc.PD as string,
          serviceDate: toDbDate(today),
          seq: n.seq,
          ticketNo: n.ticketNo,
          appointmentId,
          patientId: p.id,
          source: 'booking',
          reserved: true,
        },
      });
    });
  }
  return { ...p, ...ids, bookingCode: code, appointmentId, controlNo };
}

const identify = (token: string, body: Record<string, unknown>) =>
  http()
    .post('/api/v1/kiosk/identify')
    .set(asDevice(token))
    .send({ purpose: 'booking', ...body });

async function lookupToken(token: string, value: string, method = 'nik', purpose = 'booking') {
  const res = await identify(token, { method, value, purpose }).expect(200);
  expect(res.body.found).toBe(true);
  return res.body.lookupToken as string;
}

const checkIn = (token: string, lookup: string, idem?: string) => {
  const req = http().post('/api/v1/kiosk/check-in').set(asDevice(token));
  if (idem) req.set('Idempotency-Key', idem);
  return req.send({ lookupToken: lookup });
};

const audits = (where: Record<string, unknown>) =>
  run((tx) => tx.auditEvent.findMany({ where, orderBy: { seq: 'asc' } }));

beforeAll(async () => {
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  app = await createTestApp();
  // Server tetap mendengarkan: permintaan bersarang (token dari identifikasi di dalam argumen `send`) aman.
  await app.listen(0, '127.0.0.1');
  T = await createTestTenant();
  OTHER = await createTestTenant();
  for (const id of [T.id, OTHER.id]) {
    await withTenant(owner, id, (tx) => seedHospitalStructure(tx, id));
    await seedFrontOffice(owner, id);
  }
  await run(async (tx) => {
    for (const s of await tx.queueService.findMany({ select: { id: true, code: true, unitId: true } })) {
      svc[s.code] = s.id;
      if (s.unitId) unit[s.code] = s.unitId;
    }
    practitionerId = newId();
    await tx.practitioner.create({
      data: { id: practitionerId, tenantId: T.id, name: 'dr. Uji Anjungan, Sp.PD' },
    });
    sessionId = newId();
    await tx.scheduleSession.create({
      data: {
        id: sessionId,
        tenantId: T.id,
        practitionerId,
        serviceId: svc.PD as string,
        sessionDate: toDbDate(today),
        startTime: new Date('1970-01-01T00:00:00Z'),
        endTime: new Date('1970-01-01T23:59:00Z'),
        quotaJkn: 50,
        quotaNonJkn: 10,
      },
    });
  });
  const otherUnit = await withTenant(owner, OTHER.id, (tx) =>
    tx.queueService.findFirstOrThrow({ where: { code: 'A' }, select: { unitId: true } }),
  );

  admin = await login(
    app,
    await createTestUser(T.id, { roles: [{ code: 'admin_tenant' }], tenantCode: T.code }),
  );
  otherAdmin = await login(
    app,
    await createTestUser(OTHER.id, { roles: [{ code: 'admin_tenant' }], tenantCode: OTHER.code }),
  );
  await withTenant(owner, T.id, (tx) =>
    tx.tenantSetting.create({ data: { tenantId: T.id, key: 'kiosk.lookup_rate_per_min', value: 60 } }),
  );
  const r = await createTestUser(T.id, { roles: [{ code: 'petugas_pendaftaran' }], tenantCode: T.code });
  registrarId = r.id;
  registrar = await login(app, r);

  dev.kiosk = await enrolDevice(admin, T.code, 'kiosk', unit.A as string);
  dev.kiosk2 = await enrolDevice(admin, T.code, 'kiosk', unit.A as string, 'Anjungan lantai 2 uji');
  dev.kioskRate = await enrolDevice(
    otherAdmin,
    OTHER.code,
    'kiosk',
    otherUnit.unitId as string,
    'Anjungan batas laju',
  );
  dev.tv = await enrolDevice(admin, T.code, 'queue_display', unit.PD as string, 'TV ruang tunggu uji');
  dev.otherKiosk = await enrolDevice(otherAdmin, OTHER.code, 'kiosk', otherUnit.unitId as string);
});

afterAll(async () => {
  await app?.close();
  await owner?.$disconnect();
});

describe('hanya perangkat anjungan', () => {
  it('token staf → 403; tanpa kredensial → 401; TV (izin lain) → 403 tercatat', async () => {
    const body = { purpose: 'booking', method: 'nik', value: nik() };
    await http().post('/api/v1/kiosk/identify').set(bearer(registrar)).send(body).expect(403);
    await http().post('/api/v1/kiosk/identify').send(body).expect(401);
    await http().post('/api/v1/kiosk/identify').set(asDevice(dev.tv.token)).send(body).expect(403);
    const denied = await audits({ action: 'access_denied', resourceType: 'device_endpoint' });
    expect(denied.at(-1)?.details).toMatchObject({ permission: 'kiosk.use', deviceId: dev.tv.id });
  });

  it('isian divalidasi kontrak (jumlah digit per cara)', async () => {
    await identify(dev.kiosk.token, { method: 'nik', value: '123' }).expect(400);
    await identify(dev.kiosk.token, { method: 'booking', value: 'ABCDEFGHIJ' }).expect(400);
  });
});

describe('identifikasi', () => {
  it('NIK cocok → nama tersamar + tanggal lahir tanpa tahun + token; tanpa ID pasien/RM/NIK; diaudit atas nama perangkat', async () => {
    const p = await patient({ booking: 'jkn' });
    const res = await identify(dev.kiosk.token, { method: 'nik', value: p.nik }).expect(200);
    const body = kioskIdentifyResultSchema.parse(res.body);
    expect(body).toMatchObject({
      found: true,
      nameMasked: 'Si•• Ra•••••••',
      birthDayMonth: '14 Mar',
      hasBookingToday: true,
    });
    const text = JSON.stringify(res.body);
    for (const leak of [p.id, p.mrn, p.nik, p.bpjs, 'Siti', 'Rahmawati', '1985'])
      expect(text).not.toContain(leak);

    const rows = await audits({ resourceType: 'kiosk_lookup', patientId: p.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'search', actorUserId: null, outcome: 'success' });
    expect(rows[0]?.details).toMatchObject({
      method: 'nik',
      purpose: 'booking',
      found: true,
      deviceId: dev.kiosk.id,
      deviceKind: 'kiosk',
    });
    expect(jsonText(rows)).not.toContain(p.nik);
  });

  it('kartu BPJS dan kode booking juga menemukan pasien; booking pasien tanpa booking hari ini = false', async () => {
    const withBooking = await patient({
      booking: 'non_jkn',
      name: 'Budi Santoso Uji',
      birthDate: '1979-11-02',
    });
    const byCard = await identify(dev.kiosk.token, { method: 'bpjs', value: withBooking.bpjs }).expect(200);
    expect(byCard.body).toMatchObject({
      found: true,
      nameMasked: 'Bu•• Sa••••• Uj•',
      birthDayMonth: '2 Nov',
    });
    const byCode = await identify(dev.kiosk.token, {
      method: 'booking',
      value: withBooking.bookingCode,
    }).expect(200);
    expect(byCode.body).toMatchObject({ found: true, hasBookingToday: true });

    const noBooking = await patient();
    const res = await identify(dev.kiosk.token, { method: 'nik', value: noBooking.nik }).expect(200);
    expect(res.body).toMatchObject({ found: true, hasBookingToday: false });
  });

  it('tidak ditemukan → 200 {found:false} seragam; NIK ganda di dua rekam medis juga tidak ditemukan', async () => {
    const miss = await identify(dev.kiosk.token, { method: 'nik', value: nik() }).expect(200);
    expect(miss.body).toEqual({ found: false });
    const missCode = await identify(dev.kiosk.token, { method: 'booking', value: bookingCode() }).expect(200);
    expect(missCode.body).toEqual({ found: false });

    const shared = nik();
    await createTestPatient(T.id, {
      name: 'Pasien Kembar Satu',
      birthDate: '1990-01-01',
      identifiers: { nik: shared },
    });
    await createTestPatient(T.id, {
      name: 'Pasien Kembar Dua',
      birthDate: '1991-01-01',
      identifiers: { nik: shared },
    });
    const dup = await identify(dev.kiosk.token, { method: 'nik', value: shared }).expect(200);
    expect(dup.body).toEqual({ found: false });

    const rows = await run((tx) =>
      tx.kioskLookup.findMany({
        where: { deviceId: dev.kiosk.id, found: false },
        select: { tokenHash: true, patientId: true },
      }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((r) => r.tokenHash === null && r.patientId === null)).toBe(true);
  });

  it('anjungan RS lain tidak menemukan pasien RS ini (RLS)', async () => {
    const p = await patient();
    const res = await identify(dev.otherKiosk.token, { method: 'nik', value: p.nik }).expect(200);
    expect(res.body).toEqual({ found: false });
  });

  it('batas pencarian per perangkat (bawaan 10/menit) → 429 RATE_LIMITED tercatat; perangkat lain tidak terdampak', async () => {
    for (let i = 0; i < 10; i++) {
      await identify(dev.kioskRate.token, { method: 'nik', value: nik() }).expect(200);
    }
    const blocked = await identify(dev.kioskRate.token, { method: 'nik', value: nik() }).expect(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    const [denied, counted] = await withTenant(testDb(), OTHER.id, (tx) =>
      Promise.all([
        tx.auditEvent.findMany({ where: { action: 'access_denied', resourceType: 'kiosk_lookup' } }),
        tx.kioskLookup.count({ where: { deviceId: dev.kioskRate.id } }),
      ]),
    );
    expect(denied.at(-1)?.details).toMatchObject({
      reason: 'rate_limited',
      limit: 10,
      deviceId: dev.kioskRate.id,
    });
    expect(counted).toBe(10);
    await identify(dev.otherKiosk.token, { method: 'nik', value: nik() }).expect(200);
  });
});

describe('check-in booking', () => {
  it('JKN: tiket loket A-xxx bersumber anjungan, booking checked_in, task 1, audit perangkat; sentuhan ganda = tiket sama', async () => {
    const p = await patient({ booking: 'jkn' });
    const token = await lookupToken(dev.kiosk.token, p.nik);
    await checkIn(dev.kiosk.token, token).expect(400);
    const idem = key();
    const res = await checkIn(dev.kiosk.token, token, idem).expect(200);
    const ticket = printableTicketSchema.parse(res.body);
    expect(ticket).toMatchObject({
      tenantName: 'RS Fiktif Uji',
      destination: 'Loket Pendaftaran',
      location: 'Lantai 1 · Lobi Utama',
      bookingCode: p.bookingCode,
      sepNo: null,
    });
    expect(ticket.queueNo).toMatch(/^A-\d{3}$/);
    expect(JSON.stringify(res.body)).not.toContain(p.id);

    const again = await checkIn(dev.kiosk.token, token, idem).expect(200);
    expect(again.body.ticketId).toBe(ticket.ticketId);
    const other = await checkIn(dev.kiosk.token, token, key()).expect(410);
    expect(other.body.code).toBe('KIOSK_LOOKUP_EXPIRED');

    const [appt, tickets, tasks] = await run((tx) =>
      Promise.all([
        tx.appointment.findUniqueOrThrow({ where: { id: p.appointmentId as string } }),
        tx.queueTicket.findMany({ where: { appointmentId: p.appointmentId, serviceId: svc.A } }),
        tx.bpjsQueueTask.findMany({ where: { appointmentId: p.appointmentId } }),
      ]),
    );
    expect(appt.status).toBe('checked_in');
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ id: ticket.ticketId, source: 'anjungan', patientId: p.id });
    expect(tasks.map((t) => t.taskId)).toContain(1);

    const rows = await audits({ resourceType: 'appointment', resourceId: p.appointmentId });
    expect(rows.at(-1)).toMatchObject({ action: 'update', patientId: p.id, actorUserId: null });
    expect(rows.at(-1)?.details).toMatchObject({
      status: 'checked_in',
      channel: 'anjungan',
      deviceId: dev.kiosk.id,
    });
  });

  it('non-JKN juga mendapat tiket loket; booking yang sudah check-in → tiket yang sama dicetak ulang', async () => {
    const p = await patient({ booking: 'non_jkn' });
    const first = await checkIn(dev.kiosk.token, await lookupToken(dev.kiosk.token, p.nik), key()).expect(
      200,
    );
    expect(first.body.queueNo).toMatch(/^A-\d{3}$/);
    const second = await checkIn(
      dev.kiosk.token,
      await lookupToken(dev.kiosk.token, p.bookingCode, 'booking'),
      key(),
    );
    expect(second.status).toBe(200);
    expect(second.body.ticketId).toBe(first.body.ticketId);
  });

  it('tanpa booking hari ini → 422 KIOSK_NEEDS_COUNTER (bukan_hari_layanan)', async () => {
    const p = await patient();
    const res = await checkIn(dev.kiosk.token, await lookupToken(dev.kiosk.token, p.nik), key()).expect(422);
    expect(res.body).toMatchObject({
      code: 'KIOSK_NEEDS_COUNTER',
      details: { reason: 'bukan_hari_layanan', ticket: null },
    });
  });

  it('token perangkat lain → 410 tercatat; token kedaluwarsa atau palsu → 410', async () => {
    const p = await patient({ booking: 'jkn' });
    const token = await lookupToken(dev.kiosk.token, p.nik);
    const stolen = await checkIn(dev.kiosk2.token, token, key()).expect(410);
    expect(stolen.body.code).toBe('KIOSK_LOOKUP_EXPIRED');
    const denied = await audits({ action: 'access_denied', resourceType: 'kiosk_lookup' });
    expect(denied.at(-1)?.details).toMatchObject({ reason: 'other_device', deviceId: dev.kiosk2.id });

    const expired = `kl1.${randomBytes(32).toString('base64url')}`;
    const old = new Date(Date.now() - 10 * 60_000);
    await withTenant(owner, T.id, (tx) =>
      tx.kioskLookup.create({
        data: {
          id: newId(),
          tenantId: T.id,
          deviceId: dev.kiosk.id,
          purpose: 'booking',
          method: 'nik',
          found: true,
          tokenHash: createHash('sha256').update(expired).digest('hex'),
          patientId: p.id,
          appointmentId: p.appointmentId,
          createdAt: old,
          expiresAt: new Date(old.getTime() + 180_000),
        },
      }),
    );
    await checkIn(dev.kiosk.token, expired, key()).expect(410);
    await checkIn(dev.kiosk.token, `kl1.${'y'.repeat(43)}`, key()).expect(410);
    // Booking tetap belum check-in.
    const appt = await run((tx) =>
      tx.appointment.findUniqueOrThrow({ where: { id: p.appointmentId as string } }),
    );
    expect(appt.status).toBe('booked');
  });
});

describe('tiket dan cetak', () => {
  it('tiket loket tanpa identitas; farmasi butuh identifikasi; kasir belum ada layanannya → 409', async () => {
    const loket = await http()
      .post('/api/v1/kiosk/tickets')
      .set(asDevice(dev.kiosk.token))
      .send({ serviceKind: 'loket' })
      .expect(201);
    expect(loket.body.queueNo).toMatch(/^A-\d{3}$/);
    const row = await run((tx) => tx.queueTicket.findUniqueOrThrow({ where: { id: loket.body.ticketId } }));
    expect(row).toMatchObject({ source: 'anjungan', patientId: null, appointmentId: null });

    await http()
      .post('/api/v1/kiosk/tickets')
      .set(asDevice(dev.kiosk.token))
      .send({ serviceKind: 'farmasi' })
      .expect(400);

    const p = await patient();
    const first = await http()
      .post('/api/v1/kiosk/tickets')
      .set(asDevice(dev.kiosk.token))
      .send({
        serviceKind: 'farmasi',
        lookupToken: await lookupToken(dev.kiosk.token, p.nik, 'nik', 'farmasi_kasir'),
      })
      .expect(201);
    expect(first.body).toMatchObject({ destination: 'Farmasi Rawat Jalan' });
    expect(first.body.queueNo).toMatch(/^F-\d{3}$/);
    // Ambil ulang (identifikasi baru) → tiket menunggu yang sama, tidak menambah nomor.
    const again = await http()
      .post('/api/v1/kiosk/tickets')
      .set(asDevice(dev.kiosk.token))
      .send({
        serviceKind: 'farmasi',
        lookupToken: await lookupToken(dev.kiosk.token, p.nik, 'nik', 'farmasi_kasir'),
      })
      .expect(201);
    expect(again.body.ticketId).toBe(first.body.ticketId);
    const linked = await run((tx) =>
      tx.queueTicket.findUniqueOrThrow({ where: { id: first.body.ticketId } }),
    );
    expect(linked.patientId).toBe(p.id);

    const kasir = await http()
      .post('/api/v1/kiosk/tickets')
      .set(asDevice(dev.kiosk.token))
      .send({
        serviceKind: 'kasir',
        lookupToken: await lookupToken(dev.kiosk.token, p.nik, 'nik', 'farmasi_kasir'),
      })
      .expect(409);
    expect(kasir.body.code).toBe('CONFLICT');
  });

  it('cetak HTML 80 mm hanya untuk tiket perangkat ini; tiket loket staf/perangkat lain → 404 tercatat', async () => {
    const p = await patient({ booking: 'jkn' });
    const issued = await checkIn(dev.kiosk.token, await lookupToken(dev.kiosk.token, p.nik), key()).expect(
      200,
    );
    const html = await http()
      .get(`/api/v1/kiosk/tickets/${issued.body.ticketId}/print`)
      .set(asDevice(dev.kiosk.token))
      .expect(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.headers['content-security-policy']).toContain("default-src 'none'");
    expect(html.text).toContain(issued.body.queueNo);
    expect(html.text).toContain('size: 80mm');
    expect(html.text).not.toContain('Siti');
    expect(html.text).not.toContain('<script');
    const printed = await audits({ action: 'print', resourceId: issued.body.ticketId });
    expect(printed[0]).toMatchObject({ resourceType: 'queue_ticket', patientId: p.id });

    await http()
      .get(`/api/v1/kiosk/tickets/${issued.body.ticketId}/print`)
      .set(asDevice(dev.kiosk2.token))
      .expect(404);
    const staffTicket = await http()
      .post(`/api/v1/queue/services/${svc.A}/tickets`)
      .set(bearer(registrar))
      .send({})
      .expect(201);
    await http()
      .get(`/api/v1/kiosk/tickets/${staffTicket.body.id}/print`)
      .set(asDevice(dev.kiosk.token))
      .expect(404);
    const denied = await audits({
      action: 'access_denied',
      resourceType: 'queue_ticket',
      resourceId: staffTicket.body.id,
    });
    expect(denied[0]?.details).toMatchObject({ reason: 'not_issued_by_device', deviceId: dev.kiosk.id });
  });
});

describe('panggil petugas', () => {
  it('notifikasi in-app ke petugas pendaftaran tanpa PHI', async () => {
    const res = await http().post('/api/v1/kiosk/assist').set(asDevice(dev.kiosk.token)).expect(200);
    expect(Object.keys(res.body)).toEqual(['requestedAt']);
    const notes = await run((tx) =>
      tx.notification.findMany({ where: { recipientUserId: registrarId, kind: 'kiosk_assist' } }),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      title: 'Anjungan meminta bantuan',
      link: `/antrean?perangkat=${dev.kiosk.id}`,
    });
    expect(notes[0]?.body).toContain('Anjungan lobi uji');
    const rows = await audits({ resourceType: 'kiosk_assist' });
    expect(rows.at(-1)?.details).toMatchObject({ notified: 1, deviceId: dev.kiosk.id });

    // Sentuhan ulang dalam jeda 60 detik: tidak ada notifikasi baru, waktu panggilan pertama dikembalikan.
    const again = await http().post('/api/v1/kiosk/assist').set(asDevice(dev.kiosk.token)).expect(200);
    expect(again.body.requestedAt).toBe(notes[0]?.createdAt.toISOString());
    const after = await run((tx) =>
      tx.notification.count({ where: { recipientUserId: registrarId, kind: 'kiosk_assist' } }),
    );
    expect(after).toBe(1);
    expect((await audits({ resourceType: 'kiosk_assist' })).at(-1)?.details).toMatchObject({
      notified: 0,
      repeated: true,
    });
    // Anjungan lain tetap bisa memanggil.
    await http().post('/api/v1/kiosk/assist').set(asDevice(dev.kiosk2.token)).expect(200);
    const both = await run((tx) =>
      tx.notification.count({ where: { recipientUserId: registrarId, kind: 'kiosk_assist' } }),
    );
    expect(both).toBe(2);
  });
});

describe('batas tiket tanpa identitas', () => {
  it('tiket loket anonim per perangkat dibatasi (6/menit) → 429 tercatat; perangkat lain tidak terdampak', async () => {
    const take = (token: string) =>
      http().post('/api/v1/kiosk/tickets').set(asDevice(token)).send({ serviceKind: 'loket' });
    const already = await run((tx) =>
      tx.kioskTicket.count({
        where: { deviceId: dev.kiosk2.id, createdAt: { gte: new Date(Date.now() - 60_000) } },
      }),
    );
    for (let i = already; i < 6; i++) await take(dev.kiosk2.token).expect(201);
    const blocked = await take(dev.kiosk2.token).expect(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    const denied = await audits({ action: 'access_denied', resourceType: 'kiosk_ticket' });
    expect(denied.at(-1)?.details).toMatchObject({ reason: 'rate_limited', deviceId: dev.kiosk2.id });
    await take(dev.otherKiosk.token).expect(201);
  });
});

describe('registrasi mandiri (alur 5a)', () => {
  /** Diagnosa awal fiktif dari fixture registrasi 5a (`registration.test.ts`), tidak dikarang. */
  const DIAG = { code: 'I10', display: 'Hipertensi esensial (primer)' };

  /** Persetujuan umum rawat jalan aktif + surat kontrol tercatat (hasil lookup VClaim sebelumnya). */
  async function readyForBpjs(p: Awaited<ReturnType<typeof patient>>, opts: { consent?: boolean } = {}) {
    await run(async (tx) => {
      if (opts.consent !== false) {
        await tx.privacyConsent.create({
          data: { id: newId(), tenantId: T.id, patientId: p.id, kind: 'umum', note: 'Persetujuan umum uji' },
        });
      }
      await tx.referral.create({
        data: {
          id: newId(),
          tenantId: T.id,
          patientId: p.id,
          kind: 'surat-kontrol',
          number: p.controlNo,
          facilityName: 'Poli Penyakit Dalam',
          targetServiceId: svc.PD,
          diagnosisCode: DIAG.code,
          diagnosisDisplay: DIAG.display,
          issuedOn: toDbDate(today),
          status: 'active',
        },
      });
    });
  }

  const register = (lookup: string, body: Record<string, unknown>, idem?: string) => {
    const req = http().post('/api/v1/kiosk/register').set(asDevice(dev.kiosk.token));
    if (idem) req.set('Idempotency-Key', idem);
    return req.send({ lookupToken: lookup, ...body });
  };

  it('BPJS kontrol: kunjungan + SEP pending (outbox) lewat RegistrationService, tiket poli; ulangan = tiket sama', async () => {
    const p = await patient({ booking: 'jkn' });
    await readyForBpjs(p);
    const token = await lookupToken(dev.kiosk.token, p.bpjs, 'bpjs', 'bpjs');
    await register(token, { payer: 'bpjs' }).expect(400);
    await register(token, { payer: 'bpjs' }, 'bukan-uuid').expect(400);
    const idem = newId();
    const res = await register(token, { payer: 'bpjs' }, idem).expect(201);
    const ticket = printableTicketSchema.parse(res.body);
    expect(ticket.queueNo).toMatch(/^PD-\d{3}$/);
    expect(ticket).toMatchObject({ destination: 'Penyakit Dalam', sepNo: null, bookingCode: p.bookingCode });
    expect(JSON.stringify(res.body)).not.toContain(p.id);

    const again = await register(token, { payer: 'bpjs' }, idem).expect(201);
    expect(again.body.ticketId).toBe(ticket.ticketId);

    const [encounters, seps, outbox, appt] = await run((tx) =>
      Promise.all([
        tx.encounter.findMany({ where: { patientId: p.id } }),
        tx.sep.findMany({ where: { encounter: { patientId: p.id } } }),
        tx.outboxMessage.findMany({
          where: { operation: 'bpjs.vclaim.sep.insert' },
          select: { payload: true },
        }),
        tx.appointment.findUniqueOrThrow({ where: { id: p.appointmentId as string } }),
      ]),
    );
    expect(encounters).toHaveLength(1);
    expect(encounters[0]).toMatchObject({ appointmentId: p.appointmentId, queueTicketId: ticket.ticketId });
    expect(seps).toHaveLength(1);
    expect(seps[0]).toMatchObject({ status: 'pending', diagnosisCode: 'I10' });
    expect(jsonText(outbox)).toContain(seps[0]?.id);
    expect(appt.status).toBe('checked_in');

    const rows = await audits({ resourceType: 'encounter', patientId: p.id });
    expect(rows[0]).toMatchObject({ action: 'create', actorUserId: null });
    expect(rows[0]?.details).toMatchObject({ deviceId: dev.kiosk.id, deviceKind: 'kiosk' });
  });

  it('tanpa persetujuan umum → 422 KIOSK_NEEDS_COUNTER, tidak ada yang tersimpan', async () => {
    const p = await patient({ booking: 'jkn' });
    await readyForBpjs(p, { consent: false });
    const token = await lookupToken(dev.kiosk.token, p.nik, 'nik', 'bpjs');
    const res = await register(token, { payer: 'bpjs' }, newId()).expect(422);
    expect(res.body).toMatchObject({
      code: 'KIOSK_NEEDS_COUNTER',
      details: { reason: 'data_belum_lengkap' },
    });
    const [encounters, appt, lookup] = await run((tx) =>
      Promise.all([
        tx.encounter.count({ where: { patientId: p.id } }),
        tx.appointment.findUniqueOrThrow({ where: { id: p.appointmentId as string } }),
        tx.kioskLookup.findFirstOrThrow({ where: { patientId: p.id }, orderBy: { createdAt: 'desc' } }),
      ]),
    );
    expect(encounters).toBe(0);
    expect(appt.status).toBe('booked');
    expect(lookup.usedAt).toBeNull();
  });

  it('BPJS tanpa surat kontrol tercatat → 422 rujukan_tidak_berlaku', async () => {
    const p = await patient({ booking: 'jkn' });
    const token = await lookupToken(dev.kiosk.token, p.nik, 'nik', 'bpjs');
    const res = await register(token, { payer: 'bpjs' }, newId()).expect(422);
    expect(res.body.details).toMatchObject({ reason: 'rujukan_tidak_berlaku' });
  });

  it('umum: sesi hari ini dari GET sessions → kunjungan umum + tiket poli, tanpa SEP', async () => {
    const list = await http().get('/api/v1/kiosk/sessions').set(asDevice(dev.kiosk.token)).expect(200);
    const options = kioskSessionOptionSchema.array().parse(list.body);
    expect(options.map((o) => o.sessionId)).toContain(sessionId);
    await http().get('/api/v1/kiosk/sessions').set(bearer(registrar)).expect(403);

    const p = await patient({ name: 'Dewi Lestari Uji', birthDate: '1992-07-21' });
    await run((tx) =>
      tx.privacyConsent.create({
        data: { id: newId(), tenantId: T.id, patientId: p.id, kind: 'umum', note: 'Persetujuan umum uji' },
      }),
    );
    const token = await lookupToken(dev.kiosk.token, p.nik, 'nik', 'umum');
    const res = await register(token, { payer: 'umum', sessionId }, newId()).expect(201);
    expect(res.body.queueNo).toMatch(/^PD-\d{3}$/);
    const [enc, seps] = await run((tx) =>
      Promise.all([
        tx.encounter.findFirstOrThrow({ where: { patientId: p.id } }),
        tx.sep.count({ where: { encounter: { patientId: p.id } } }),
      ]),
    );
    expect(enc.queueTicketId).toBe(res.body.ticketId);
    expect(seps).toBe(0);
  });
});
