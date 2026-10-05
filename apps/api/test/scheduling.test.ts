/**
 * F01 · API jadwal praktik dan kuota (fase 2 potongan 2): bangkitkan sesi, grid minggu, kuota berversi tidak di bawah
 * booking, cuti + pengganti + pengalihan (semua atau tidak sama sekali), templat (bentrok), kirim/tarik HFIS lewat
 * outbox (202), perbedaan RS vs HFIS dari tarikan, izin per peran, isolasi tenant, dan audit. Data fiktif (seed 0b).
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addIsoDays,
  createPrismaClient,
  dbDateFromIso,
  ensureSystemRoles,
  isoWeekday,
  type PrismaClient,
  reserveQuota,
  seedFrontOffice,
  seedHospitalStructure,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import {
  type HfisPullSnapshot,
  hfisDifferencesSchema,
  isoDateJakarta,
  newId,
  practitionerQuotaSchema,
  scheduleSessionSchema,
  weeklyScheduleSchema,
} from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bearer, createTestApp, createTestPatient, createTestUser, login, TENANT_A, testDb } from './helpers';

let app: NestExpressApplication;
let db: PrismaClient;
let T: { id: string; code: string };
const http = () => request(app.getHttpServer());
const as = (tenant: string) => ({
  get: (url: string) => http().get(url).set('X-Tenant-Id', tenant),
  post: (url: string, body: object = {}) => http().post(url).set('X-Tenant-Id', tenant).send(body),
  patch: (url: string, body: object) => http().patch(url).set('X-Tenant-Id', tenant).send(body),
});
const api = '/api/v1/scheduling';
const today = isoDateJakarta(new Date());
const inT = <R>(fn: (tx: TenantTx) => Promise<R>) => withTenant(db, T.id, fn);

/** RS fiktif baru seperti `pnpm db:seed` (struktur + front office), agar data jadwal tidak bercampur antar-tes. */
async function freshTenant() {
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  const id = newId();
  const code = `J${id
    .slice(-8)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X')}`;
  try {
    await withTenant(owner, id, async (tx) => {
      await tx.tenant.create({ data: { id, code, name: 'RS Fiktif Uji Jadwal' } });
      await ensureSystemRoles(tx, id);
      await seedHospitalStructure(tx, id);
    });
    await seedFrontOffice(owner, id);
  } finally {
    await owner.$disconnect();
  }
  return { id, code };
}

const practitioner = (prefix: string) =>
  inT((tx) =>
    tx.practitioner.findFirstOrThrow({ where: { name: { startsWith: prefix } }, select: { id: true } }),
  );

/** Sesi praktik pertama dokter ini mulai besok (hari ini bisa sudah lewat jamnya / Minggu). */
async function nextSession(practitionerId: string, after = today) {
  const res = await as(T.id)
    .get(
      `${api}/sessions?from=${addIsoDays(after, 1)}&to=${addIsoDays(after, 14)}&practitionerId=${practitionerId}`,
    )
    .expect(200);
  const list = z.array(scheduleSessionSchema).parse(res.body);
  const s = list.find((x) => x.kind === 'praktik' && x.practitionerId === practitionerId);
  if (!s) throw new Error('Sesi praktik tidak ditemukan');
  return s;
}

/** Booking non-JKN fiktif langsung di DB (reservasi kuota atomik seperti modul booking). */
async function book(session: { id: string; practitionerId: string; serviceId: string; serviceDate: string }) {
  const patient = await createTestPatient(T.id, { name: 'Pasien Jadwal Fiktif' });
  return inT(async (tx) => {
    expect(await reserveQuota(tx, session.id, 'non_jkn')).not.toBeNull();
    const id = newId();
    await tx.appointment.create({
      data: {
        id,
        tenantId: T.id,
        bookingCode: String(Math.floor(1e9 + Math.random() * 8.9e9)),
        patientId: patient.id,
        sessionId: session.id,
        practitionerId: session.practitionerId,
        serviceId: session.serviceId,
        appointmentDate: dbDateFromIso(session.serviceDate),
        quotaBucket: 'non_jkn',
        channel: 'loket',
      },
    });
    return id;
  });
}

beforeAll(async () => {
  app = await createTestApp();
  db = testDb();
  T = await freshTenant();
  await as(T.id).post(`${api}/sessions/generate`, {}).expect(200);
});

afterAll(async () => {
  await app?.close();
});

describe('sesi dari templat', () => {
  it('membangkitkan 30 hari sekali saja (idempoten) dan tercatat di audit', async () => {
    const again = await as(T.id).post(`${api}/sessions/generate`, {}).expect(200);
    expect(again.body).toMatchObject({ from: today, to: addIsoDays(today, 29), created: 0 });
    const count = await inT((tx) => tx.scheduleSession.count());
    expect(count).toBeGreaterThan(30);
    const audit = await inT((tx) =>
      tx.auditEvent.findMany({ where: { resourceType: 'schedule_session', action: 'create' } }),
    );
    expect(audit.length).toBe(2);
    expect(audit.some((a) => (a.details as { created?: number }).created === count)).toBe(true);
  });

  it('grid minggu sah menurut kontrak tampilan; kuota templat 24/6 untuk dr. Andini', async () => {
    let monday = addIsoDays(today, 7);
    while (isoWeekday(monday) !== 1) monday = addIsoDays(monday, -1);
    const res = await as(T.id).get(`${api}/week?weekStart=${monday}`).expect(200);
    const week = weeklyScheduleSchema.parse(res.body);
    expect(week.days).toHaveLength(6);
    const andini = week.doctors.find((d) => d.name.startsWith('dr. Andini'));
    expect(andini).toMatchObject({ poliCode: 'PD', poliName: 'Penyakit Dalam', room: 'Ruang 2' });
    expect(andini?.slots[0]).toMatchObject({
      kind: 'praktik',
      start: '08.00',
      quota: { jkn: 24, nonJkn: 6 },
    });
    expect(andini?.slots[4]).toMatchObject({ kind: 'libur', sessionId: null });
    expect(week.hfis).toEqual({ lastSyncAt: null, differences: [] });
    await as(T.id)
      .get(`${api}/week?weekStart=${addIsoDays(monday, 1)}`)
      .expect(400);
  });

  it('kuota hari ini sesuai kontrak meja pendaftaran', async () => {
    const res = await as(T.id).get(`${api}/quotas/today`).expect(200);
    const quotas = z.array(practitionerQuotaSchema).parse(res.body);
    for (const q of quotas) expect(q.nextQueueNo).toMatch(new RegExp(`^${q.poliCode}-001$`));
  });
});

describe('kuota sesi', () => {
  it('tidak bisa di bawah booking (409 QUOTA_BELOW_BOOKED), berversi (409 STALE), perubahan diaudit', async () => {
    const andini = await practitioner('dr. Andini');
    const s = await nextSession(andini.id);
    await book(s);
    const below = await as(T.id)
      .patch(`${api}/sessions/${s.id}/quota`, { quotaJkn: 24, quotaNonJkn: 0 })
      .expect(409);
    expect(below.body).toMatchObject({ code: 'QUOTA_BELOW_BOOKED', details: { bookedNonJkn: 1 } });

    const fresh = scheduleSessionSchema.parse(
      (await as(T.id).get(`${api}/sessions/${s.id}`).expect(200)).body,
    );
    const ok = await as(T.id)
      .patch(`${api}/sessions/${s.id}/quota`, {
        quotaJkn: 20,
        quotaNonJkn: 2,
        baseUpdatedAt: fresh.updatedAt,
      })
      .expect(200);
    expect(ok.body.quota).toMatchObject({ jkn: 20, nonJkn: 2, bookedNonJkn: 1 });
    const stale = await as(T.id)
      .patch(`${api}/sessions/${s.id}/quota`, {
        quotaJkn: 22,
        quotaNonJkn: 2,
        baseUpdatedAt: fresh.updatedAt,
      })
      .expect(409);
    expect(stale.body).toMatchObject({ code: 'CONFLICT', details: { reason: 'STALE' } });
    const audit = await inT((tx) =>
      tx.auditEvent.findFirst({
        where: { resourceType: 'schedule_session', resourceId: s.id, action: 'update' },
      }),
    );
    expect(audit?.details).toEqual({ fields: ['baseUpdatedAt', 'quotaJkn', 'quotaNonJkn'] });
    await as(T.id).patch(`${api}/sessions/${newId()}/quota`, { quotaJkn: 1, quotaNonJkn: 1 }).expect(404);
  });
});

describe('cuti, pengganti, pengalihan', () => {
  it('cuti dengan pengganti dari poli yang sama; pasien tetap di sesi atas nama pengganti + WhatsApp via outbox', async () => {
    const andini = await practitioner('dr. Andini');
    const rahmat = await practitioner('dr. Rahmat');
    const bagus = await practitioner('dr. Bagus');
    const s = await nextSession(andini.id, addIsoDays(today, 1));
    const appointmentId = await book(s);
    const leave = (body: object) => as(T.id).post(`${api}/sessions/${s.id}/leave`, body);

    expect(
      (await leave({ reason: 'Seminar', substitutePractitionerId: bagus.id }).expect(400)).body.message,
    ).toMatch(/poli yang sama/);
    await leave({ reason: 'abc', substitutePractitionerId: null }).expect(400);
    const ok = await leave({ reason: 'Seminar nasional', substitutePractitionerId: rahmat.id }).expect(200);
    expect(ok.body).toMatchObject({
      affectedBookings: 1,
      session: { kind: 'cuti', note: 'Seminar nasional', substitute: { practitionerId: rahmat.id } },
    });
    expect(
      (await leave({ reason: 'Seminar nasional', substitutePractitionerId: null }).expect(409)).body.code,
    ).toBe('SESSION_CLOSED');
    const audit = await inT((tx) =>
      tx.auditEvent.findFirst({ where: { resourceId: s.id, reason: 'Seminar nasional' } }),
    );
    expect(audit?.details).toEqual({ kind: 'cuti', affectedBookings: 1 });

    const moved = await as(T.id)
      .post(`${api}/sessions/${s.id}/transfer`, { target: { kind: 'substitute' } })
      .expect(200);
    expect(moved.body).toEqual({ moved: 1, notified: 1 });
    const a = await inT((tx) => tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } }));
    expect(a).toMatchObject({ practitionerId: rahmat.id, sessionId: s.id });
    const outbox = await inT((tx) =>
      tx.outboxMessage.findMany({ where: { operation: 'patient.whatsapp.schedule_changed' } }),
    );
    expect(outbox.map((m) => m.payload)).toContainEqual({ appointmentId });
    // BPJS: kode booking tetap, Antrean tidak punya ubah dokter → tidak ada outbox antrean untuk pengalihan ini.
    expect(
      await inT((tx) =>
        tx.outboxMessage.count({ where: { payload: { equals: { appointmentId } }, target: 'bpjs' } }),
      ),
    ).toBe(0);

    // Penanda tersimpan: grid menandai "sudah dialihkan"; pengalihan ulang tidak mengirim WhatsApp lagi.
    const session = scheduleSessionSchema.parse(
      (await as(T.id).get(`${api}/sessions/${s.id}`).expect(200)).body,
    );
    expect(session.transferredAt).not.toBeNull();
    const again = await as(T.id)
      .post(`${api}/sessions/${s.id}/transfer`, { target: { kind: 'substitute' } })
      .expect(200);
    expect(again.body).toEqual({ moved: 0, notified: 0 });
    let monday = s.serviceDate;
    while (isoWeekday(monday) !== 1) monday = addIsoDays(monday, -1);
    const week = weeklyScheduleSchema.parse(
      (await as(T.id).get(`${api}/week?weekStart=${monday}`).expect(200)).body,
    );
    const cell = week.doctors.flatMap((d) => d.slots).find((x) => x.sessionId === s.id && x.kind === 'cuti');
    expect(cell?.transferredAt).toBe(session.transferredAt);
    const wa = await inT((tx) =>
      tx.outboxMessage.count({
        where: { operation: 'patient.whatsapp.schedule_changed', payload: { equals: { appointmentId } } },
      }),
    );
    expect(wa).toBe(1);
  });

  it('pindah ke sesi lain: kuota tujuan kurang → 409 QUOTA_FULL tanpa ada yang pindah; cukup → semua pindah', async () => {
    const kartika = await practitioner('dr. Kartika');
    const source = await nextSession(kartika.id);
    const target = await nextSession(kartika.id, source.serviceDate);
    const a1 = await book(source);
    const a2 = await book(source);
    await as(T.id)
      .post(`${api}/sessions/${source.id}/leave`, {
        reason: 'Sakit mendadak',
        substitutePractitionerId: null,
      })
      .expect(200);
    // Tujuan hanya sisa satu tempat non-JKN.
    await as(T.id).patch(`${api}/sessions/${target.id}/quota`, { quotaJkn: 16, quotaNonJkn: 1 }).expect(200);
    const transfer = () =>
      as(T.id).post(`${api}/sessions/${source.id}/transfer`, {
        target: { kind: 'session', sessionId: target.id },
        notifyPatients: false,
      });
    expect((await transfer().expect(409)).body.code).toBe('QUOTA_FULL');
    const stay = await inT((tx) => tx.appointment.findMany({ where: { id: { in: [a1, a2] } } }));
    expect(stay.every((x) => x.sessionId === source.id)).toBe(true);

    await as(T.id).patch(`${api}/sessions/${target.id}/quota`, { quotaJkn: 16, quotaNonJkn: 4 }).expect(200);
    expect((await transfer().expect(200)).body).toEqual({ moved: 2, notified: 0 });
    const after = await inT((tx) =>
      tx.scheduleSession.findMany({ where: { id: { in: [source.id, target.id] } } }),
    );
    expect(after.find((x) => x.id === source.id)?.bookedNonJkn).toBe(0);
    expect(after.find((x) => x.id === target.id)?.bookedNonJkn).toBe(2);
    expect(after.find((x) => x.id === source.id)).toMatchObject({ transferTarget: 'session' });
    // Jadwal ulang lewat modul booking: booking lama batal, booking baru berkode baru di sesi tujuan.
    const old = await inT((tx) => tx.appointment.findMany({ where: { id: { in: [a1, a2] } } }));
    expect(old.every((x) => x.status === 'cancelled' && x.sessionId === source.id)).toBe(true);
    const moved = await inT((tx) =>
      tx.appointment.findMany({ where: { sessionId: target.id, status: 'booked' } }),
    );
    expect(moved).toHaveLength(2);
    expect(moved.some((m) => old.some((o) => o.bookingCode === m.bookingCode))).toBe(false);
    // Pengganti belum ada: pengalihan "substitute" ditolak.
    await as(T.id)
      .post(`${api}/sessions/${source.id}/transfer`, { target: { kind: 'substitute' } })
      .expect(400);
  });
});

describe('pengalihan pasien JKN', () => {
  it('pindah sesi: Antrean BPJS dibatalkan untuk booking lama dan ditambahkan untuk booking baru', async () => {
    const yudha = await practitioner('dr. Yudha');
    const source = await nextSession(yudha.id, addIsoDays(today, 2));
    const target = await nextSession(yudha.id, source.serviceDate);
    const patient = await createTestPatient(T.id, {
      name: 'Pasien JKN Jadwal Fiktif',
      identifiers: {
        nik: `99990101900${String(Date.now()).slice(-5)}`,
        bpjs: `0000${String(Date.now()).slice(-8)}1`,
      },
    });
    const created = await as(T.id)
      .post('/api/v1/booking/appointments', {
        patientId: patient.id,
        sessionId: source.id,
        quotaBucket: 'jkn',
        jkn: { visitKind: 'kontrol', referenceNumber: '0301R0011025K000117' },
      })
      .expect(201);
    const oldId = created.body.id as string;
    await as(T.id)
      .post(`${api}/sessions/${source.id}/leave`, { reason: 'Pelatihan', substitutePractitionerId: null })
      .expect(200);
    const res = await as(T.id)
      .post(`${api}/sessions/${source.id}/transfer`, { target: { kind: 'session', sessionId: target.id } })
      .expect(200);
    expect(res.body).toEqual({ moved: 1, notified: 1 });
    const newBooking = await inT((tx) =>
      tx.appointment.findFirstOrThrow({
        where: { sessionId: target.id, patientId: patient.id, status: 'booked' },
      }),
    );
    const ops = await inT((tx) =>
      tx.outboxMessage.findMany({
        where: { target: 'bpjs', idempotencyKey: { endsWith: oldId } },
        select: { operation: true },
      }),
    );
    expect(ops.map((o) => o.operation).sort()).toEqual(['bpjs.antrean.add', 'bpjs.antrean.batal']);
    const added = await inT((tx) =>
      tx.outboxMessage.findMany({
        where: { operation: 'bpjs.antrean.add', payload: { equals: { appointmentId: newBooking.id } } },
      }),
    );
    expect(added).toHaveLength(1);
    const wa = await inT((tx) =>
      tx.outboxMessage.findMany({
        where: {
          operation: 'patient.whatsapp.schedule_changed',
          payload: { equals: { appointmentId: newBooking.id } },
        },
      }),
    );
    expect(wa.map((m) => m.idempotencyKey)).toEqual([
      `patient.whatsapp.schedule_changed:${newBooking.id}:${target.id}`,
    ]);
  });
});

describe('templat mingguan', () => {
  it('membuat, mengubah, menolak jam bentrok, dan diaudit', async () => {
    const yudha = await practitioner('dr. Yudha');
    const service = await inT((tx) => tx.queueService.findFirstOrThrow({ where: { code: 'SR' } }));
    const base = {
      practitionerId: yudha.id,
      serviceId: service.id,
      weekday: 4,
      start: '13:00',
      end: '15:00',
      quotaJkn: 8,
      quotaNonJkn: 2,
      validFrom: today,
    };
    const created = await as(T.id).post(`${api}/templates`, base).expect(201);
    expect(created.body).toMatchObject({ poliCode: 'SR', weekday: 4, start: '13:00', active: true });
    expect(
      (
        await as(T.id)
          .post(`${api}/templates`, { ...base, start: '14:00', end: '16:00' })
          .expect(409)
      ).body.code,
    ).toBe('SCHEDULE_OVERLAP');
    const updated = await as(T.id).patch(`${api}/templates/${created.body.id}`, { quotaJkn: 10 }).expect(200);
    expect(updated.body.quotaJkn).toBe(10);
    const list = await as(T.id).get(`${api}/templates?practitionerId=${yudha.id}`).expect(200);
    expect(list.body.length).toBe(5);
    const audit = await inT((tx) =>
      tx.auditEvent.findMany({
        where: { resourceType: 'practitioner_schedule', resourceId: created.body.id },
      }),
    );
    expect(audit.map((x) => x.action).sort()).toEqual(['create', 'update']);
  });
});

describe('HFIS', () => {
  it('kirim → 202, satu pesan bpjs.hfis.update per dokter × poli berkode HFIS, revisi naik', async () => {
    const first = await as(T.id).post(`${api}/hfis/push`, {}).expect(202);
    expect(first.body).toEqual({ queued: 6, skipped: 0 });
    await as(T.id).post(`${api}/hfis/push`, {}).expect(202);
    const msgs = await inT((tx) => tx.outboxMessage.findMany({ where: { operation: 'bpjs.hfis.update' } }));
    expect(msgs).toHaveLength(12);
    expect(new Set(msgs.map((m) => (m.payload as { revision: number }).revision))).toEqual(new Set([1, 2]));
  });

  it('tarik → 202, pesan per poli × tanggal', async () => {
    const res = await as(T.id).post(`${api}/hfis/pull`, { days: 3 }).expect(202);
    expect(res.body).toEqual({ queued: 12, skipped: 0 });
  });

  it('perbedaan dari tarikan: cuti RS tetapi HFIS praktik → catat di aplikasi HFIS; tampil di grid minggu', async () => {
    const bagus = await practitioner('dr. Bagus');
    const s = await nextSession(bagus.id);
    await as(T.id)
      .post(`${api}/sessions/${s.id}/leave`, { reason: 'Cuti tahunan', substitutePractitionerId: null })
      .expect(200);
    const snapshot: HfisPullSnapshot = {
      serviceId: s.serviceId,
      kodepoli: 'JAN',
      tanggal: s.serviceDate,
      jadwal: [
        {
          kodedokter: 99003,
          namadokter: 'dr. Bagus Santoso, Sp.JP',
          jadwal: '09:00 - 12:00',
          kapasitaspasien: 20,
          libur: false,
        },
      ],
    };
    await inT((tx) =>
      tx.hfisScheduleSnapshot.create({
        data: {
          id: newId(),
          tenantId: T.id,
          direction: 'pull',
          periodStart: dbDateFromIso(s.serviceDate),
          periodEnd: dbDateFromIso(s.serviceDate),
          payload: snapshot,
        },
      }),
    );
    const diff = hfisDifferencesSchema.parse(
      (await as(T.id).get(`${api}/hfis/differences?from=${s.serviceDate}&to=${s.serviceDate}`).expect(200))
        .body,
    );
    // Dokter lain di poli itu tidak ada di tarikan palsu ini (perbedaan "kirim" untuknya tidak diperiksa di sini).
    const mine = diff.items.filter((i) => i.practitionerId === bagus.id);
    expect(mine).toEqual([
      expect.objectContaining({ kind: 'hfis-praktik-rs-cuti', resolution: 'aplikasi-hfis', sessionId: s.id }),
    ]);
    expect(mine[0]?.text).toMatch(/masih tercatat praktik .* di HFIS, padahal cuti/);
    // Poli lain belum ditarik untuk tanggal ini.
    expect(diff.unpulledDates).toEqual([s.serviceDate]);

    let monday = s.serviceDate;
    while (isoWeekday(monday) !== 1) monday = addIsoDays(monday, -1);
    const week = weeklyScheduleSchema.parse(
      (await as(T.id).get(`${api}/week?weekStart=${monday}`).expect(200)).body,
    );
    expect(week.hfis.lastSyncAt).not.toBeNull();
    expect(week.hfis.differences.filter((d) => d.slotId === mine[0]?.slotId)).toEqual([
      expect.objectContaining({ resolution: 'aplikasi-hfis' }),
    ]);
    const cell = week.doctors.flatMap((d) => d.slots).find((x) => x.sessionId === s.id && x.kind === 'cuti');
    expect(cell?.hfisSynced).toBe(false);
  });
});

describe('izin dan isolasi tenant', () => {
  it('kasir 403; dokter hanya baca; petugas pendaftaran boleh ubah', async () => {
    const tokens = async (code: string) =>
      bearer(await login(app, await createTestUser(T.id, { roles: [{ code }], tenantCode: T.code })));
    const andini = await practitioner('dr. Andini');
    const s = await nextSession(andini.id, addIsoDays(today, 3));
    const kasir = await tokens('kasir');
    await http().get(`${api}/sessions/${s.id}`).set(kasir).expect(403);
    const dokter = await tokens('dokter');
    await http().get(`${api}/sessions/${s.id}`).set(dokter).expect(200);
    await http()
      .patch(`${api}/sessions/${s.id}/quota`)
      .set(dokter)
      .send({ quotaJkn: 24, quotaNonJkn: 6 })
      .expect(403);
    await http().post(`${api}/hfis/push`).set(dokter).send({}).expect(403);
    const loket = await tokens('petugas_pendaftaran');
    await http()
      .patch(`${api}/sessions/${s.id}/quota`)
      .set(loket)
      .send({ quotaJkn: 23, quotaNonJkn: 6 })
      .expect(200);
    await http().post(`${api}/hfis/pull`).set(loket).send({ days: 1 }).expect(202);
  });

  it('sesi tenant lain tidak terlihat (404)', async () => {
    const andini = await practitioner('dr. Andini');
    const s = await nextSession(andini.id);
    await as(TENANT_A).get(`${api}/sessions/${s.id}`).expect(404);
    await as(TENANT_A).patch(`${api}/sessions/${s.id}/quota`, { quotaJkn: 1, quotaNonJkn: 1 }).expect(404);
  });
});
