/**
 * F02 · Operasi outbox booking terhadap mock BPJS + pesan SUNGGUHAN (`apps/mock`, port acak): tambah antrean JKN
 * (diterima → `sent`; peserta tidak aktif → `rejected` + kode), batal (menunggu tambah lebih dulu; dilewati bila tidak
 * pernah terdaftar), idempotensi kunci outbox, dan job no-show + pengingat WhatsApp H-1. Data fiktif.
 */
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { TestingModule } from '@nestjs/testing';
import {
  createPrismaClient,
  enqueueOutbox,
  insertPatient,
  type PrismaClient,
  seedFrontOffice,
  seedHospitalStructure,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import {
  BPJS_ANTREAN_ADD_OPERATION,
  BPJS_ANTREAN_BATAL_OPERATION,
  isoDateJakarta,
  jakartaParts,
  newId,
  outboxKey,
  PATIENT_WHATSAPP_BOOKING_REMINDER_OPERATION,
} from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../mock/src/config';
import { buildServer } from '../../mock/src/server';
import { MockState } from '../../mock/src/state';
import { bookingNoShowJob, bookingReminderJob } from '../src/jobs/booking-jobs';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { freshTenant, loadTestEnvFile, tenantDb, testEnv, testModule } from './helpers';

const DAY = 86_400_000;
let mock: ReturnType<typeof buildServer>;
let mockState: MockState;
let ref: TestingModule;
let db: PrismaClient;
let dispatcher: OutboxDispatcher;
let T: string;

/** Tanggal berikutnya (mulai besok, WIB) saat dr. Andini (HFIS 99001) praktik 08:00–12:00 di mock: Senin–Kamis. */
function nextPracticeDay(): string {
  for (let i = 1; i < 10; i++) {
    const at = new Date(Date.now() + i * DAY);
    const p = jakartaParts(at);
    const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Minggu
    if (dow >= 1 && dow <= 4) return isoDateJakarta(at);
  }
  throw new Error('tidak ada hari praktik');
}

beforeAll(async () => {
  loadTestEnvFile();
  mockState = new MockState();
  mock = buildServer({ ...loadConfig({}), port: 0 }, mockState);
  await mock.listen({ port: 0, host: '127.0.0.1' });
  const port = (mock.server.address() as AddressInfo).port;
  const env = testEnv({
    MOCK_BASE_URL: `http://127.0.0.1:${port}`,
    BPJS_BASE_URL: `http://127.0.0.1:${port}/bpjs`,
    BPJS_CONS_ID: '10000',
    BPJS_SECRET_KEY: 'mock-secret',
    BPJS_USER_KEY: 'mock-user-key',
    OUTBOX_HTTP_TIMEOUT_MS: '1000',
  });
  ref = await testModule(env);
  dispatcher = ref.get(OutboxDispatcher);
  db = createPrismaClient({ connectionString: env.DATABASE_URL, max: 2 });
  T = await freshTenant('Uji Booking');
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, T, (tx) => seedHospitalStructure(tx, T));
    await seedFrontOffice(owner, T);
  } finally {
    await owner.$disconnect();
  }
});

afterAll(async () => {
  await ref?.close();
  await db?.$disconnect();
  await mock?.close();
});

beforeEach(() => mockState.reset());

const run = <R>(fn: (tx: TenantTx) => Promise<R>) => tenantDb(db, T)(fn);
const dispatch = () => dispatcher.dispatchOnce({ tenantIds: [T], now: new Date(Date.now() + 1000) });
const appointment = (id: string) => run((tx) => tx.appointment.findUniqueOrThrow({ where: { id } }));
const outboxMsg = (operation: string, id: string) =>
  run((tx) =>
    tx.outboxMessage.findUniqueOrThrow({
      where: {
        tenantId_target_idempotencyKey: {
          tenantId: T,
          target: operation.startsWith('patient.') ? 'whatsapp' : 'bpjs',
          idempotencyKey: outboxKey(operation as typeof BPJS_ANTREAN_ADD_OPERATION, id),
        },
      },
    }),
  );

let n = 0;
/** Booking JKN seperti yang dibuat API (baris + nomor poli cadangan + pesan `bpjs.antrean.add`). */
async function bookJkn(opts: { cardSuffix?: string; date?: string; phone?: string | null } = {}) {
  n += 1;
  const date = opts.date ?? nextPracticeDay();
  const crypto = new PatientCrypto(
    { encKeyB64: process.env.FIELD_ENCRYPTION_KEY ?? '', hashKeyB64: process.env.FIELD_HASH_KEY ?? '' },
    T,
  );
  const tag = `${Date.now() % 1e5}${n}`.padStart(6, '0').slice(-6);
  return run(async (tx) => {
    const patient = await insertPatient(tx, crypto, {
      name: 'Pasien Antrean Fiktif',
      sex: 'female',
      birthDate: '1980-02-03',
      phone: opts.phone === undefined ? `6281200${tag}` : opts.phone,
      identifiers: { nik: `9999010101${tag}`, bpjs: `0000123${opts.cardSuffix ?? tag}` },
    });
    const service = await tx.queueService.findFirstOrThrow({ where: { code: 'PD' } });
    const practitioner = await tx.practitioner.findFirstOrThrow({
      where: { name: { startsWith: 'dr. Andini' } },
    });
    let session = await tx.scheduleSession.findFirst({
      where: { practitionerId: practitioner.id, sessionDate: new Date(`${date}T00:00:00.000Z`) },
    });
    session ??= await tx.scheduleSession.create({
      data: {
        id: newId(),
        tenantId: T,
        practitionerId: practitioner.id,
        serviceId: service.id,
        sessionDate: new Date(`${date}T00:00:00.000Z`),
        startTime: new Date('1970-01-01T08:00:00.000Z'),
        endTime: new Date('1970-01-01T12:00:00.000Z'),
        quotaJkn: 24,
        quotaNonJkn: 6,
      },
    });
    const id = newId();
    await tx.appointment.create({
      data: {
        id,
        tenantId: T,
        bookingCode: `${date.slice(2).replaceAll('-', '')}${String(n).padStart(4, '0')}`,
        patientId: patient.id,
        sessionId: session.id,
        practitionerId: practitioner.id,
        serviceId: service.id,
        appointmentDate: new Date(`${date}T00:00:00.000Z`),
        quotaBucket: 'jkn',
        jknVisitKind: 3,
        referenceNumber: '0301R0011025K000117',
        channel: 'loket',
        estimatedAt: new Date(`${date}T08:00:00+07:00`),
        bpjsSyncStatus: 'pending',
      },
    });
    await tx.queueTicket.create({
      data: {
        id: newId(),
        tenantId: T,
        serviceId: service.id,
        serviceDate: new Date(`${date}T00:00:00.000Z`),
        seq: n,
        ticketNo: `PD-${String(n).padStart(3, '0')}`,
        appointmentId: id,
        patientId: patient.id,
        source: 'booking',
        reserved: true,
      },
    });
    await enqueueOutbox(tx, T, {
      target: 'bpjs',
      operation: BPJS_ANTREAN_ADD_OPERATION,
      idempotencyKey: outboxKey(BPJS_ANTREAN_ADD_OPERATION, id),
      payload: { appointmentId: id },
    });
    return id;
  });
}

/** Batal seperti API: status + batal BPJS pending + pesan `bpjs.antrean.batal`. */
const cancel = (id: string) =>
  run(async (tx) => {
    const a = await tx.appointment.findUniqueOrThrow({ where: { id } });
    const send = a.bpjsSyncStatus === 'pending' || a.bpjsSyncStatus === 'sent';
    await tx.appointment.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: 'Pasien berhalangan',
        ...(send ? { bpjsCancelStatus: 'pending' } : {}),
      },
    });
    if (send) {
      await enqueueOutbox(tx, T, {
        target: 'bpjs',
        operation: BPJS_ANTREAN_BATAL_OPERATION,
        idempotencyKey: outboxKey(BPJS_ANTREAN_BATAL_OPERATION, id),
        payload: { appointmentId: id },
      });
    }
  });

describe('Antrean BPJS untuk booking', () => {
  it('tambah diterima → sent; batal → sent; kunci outbox satu pesan per booking per operasi', async () => {
    const id = await bookJkn();
    await dispatch();
    expect(await appointment(id)).toMatchObject({ bpjsSyncStatus: 'sent', bpjsErrorCode: null });
    expect((await appointment(id)).bpjsSyncedAt).not.toBeNull();
    const added = mockState.bpjs.antrean.get((await appointment(id)).bookingCode);
    expect(added?.request).toMatchObject({
      jenispasien: 'JKN',
      kodepoli: 'INT',
      kodedokter: 99001,
      jeniskunjungan: 3,
    });
    expect(added?.request.nomorantrean).toMatch(/^PD-\d{3}$/);

    // Mengantrekan ulang dengan kunci yang sama tidak membuat pesan kedua (idempotensi).
    const again = await run((tx) =>
      enqueueOutbox(tx, T, {
        target: 'bpjs',
        operation: BPJS_ANTREAN_ADD_OPERATION,
        idempotencyKey: outboxKey(BPJS_ANTREAN_ADD_OPERATION, id),
        payload: { appointmentId: id },
      }),
    );
    expect(again.id).toBe((await outboxMsg(BPJS_ANTREAN_ADD_OPERATION, id)).id);

    await cancel(id);
    await dispatch();
    expect(await appointment(id)).toMatchObject({ bpjsCancelStatus: 'sent', bpjsCancelErrorCode: null });
    expect(added?.status).toBe('batal');
  });

  it('walk-in loket: nomor poli sudah dilepas saat registrasi (bukan cadangan lagi) → tetap terkirim', async () => {
    const id = await bookJkn();
    await run((tx) => tx.queueTicket.updateMany({ where: { appointmentId: id }, data: { reserved: false } }));
    await dispatch();
    expect(await appointment(id)).toMatchObject({ bpjsSyncStatus: 'sent', bpjsErrorCode: null });
    const added = mockState.bpjs.antrean.get((await appointment(id)).bookingCode);
    expect(added?.request.nomorantrean).toMatch(/^PD-\d{3}$/);
  });

  it('peserta tidak aktif → ditolak BPJS: status rejected + kode (pesan terkirim, bukan DLQ); batal dilewati', async () => {
    const id = await bookJkn({ cardSuffix: '000000' });
    await dispatch();
    expect(await appointment(id)).toMatchObject({
      bpjsSyncStatus: 'rejected',
      bpjsErrorCode: 'BPJS_PESERTA_TIDAK_AKTIF',
    });
    expect((await outboxMsg(BPJS_ANTREAN_ADD_OPERATION, id)).status).toBe('sent');
    // Tidak pernah terdaftar di BPJS: API tidak mengantrekan batal (status kirim batal tetap not_required).
    await cancel(id);
    expect(await appointment(id)).toMatchObject({ bpjsCancelStatus: 'not_required' });
  });

  it('batal sebelum tambah terkirim: batal menunggu tambah, lalu keduanya terkirim berurutan', async () => {
    const id = await bookJkn();
    await cancel(id);
    await dispatch();
    await dispatch();
    expect(await appointment(id)).toMatchObject({ bpjsSyncStatus: 'sent', bpjsCancelStatus: 'sent' });
    expect(mockState.bpjs.antrean.get((await appointment(id)).bookingCode)?.status).toBe('batal');
  });

  it('batal saat tambah ditolak: batal dilewati, status batal BPJS selesai (not_required)', async () => {
    const id = await bookJkn({ cardSuffix: '000000' });
    await cancel(id);
    await dispatch();
    await dispatch();
    expect(await appointment(id)).toMatchObject({
      bpjsSyncStatus: 'rejected',
      bpjsCancelStatus: 'not_required',
    });
    expect((await outboxMsg(BPJS_ANTREAN_BATAL_OPERATION, id)).status).toBe('sent');
  });
});

describe('pasien JKN tanpa no. HP (keputusan utang fase 2)', () => {
  /** Pengaturan RS seperti lewat API pengaturan; '' = belum diatur. */
  const setContactPhone = (value: string) =>
    run((tx) =>
      tx.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: T, key: 'bpjs.contact_phone' } },
        create: { tenantId: T, key: 'bpjs.contact_phone', value },
        update: { value },
      }),
    );

  it('no. telepon RS belum diatur → DLQ dengan alasan jelas; sudah diatur → nohp = no. telepon RS', async () => {
    await setContactPhone('');
    const dead = await bookJkn({ phone: null });
    await dispatch();
    expect(await appointment(dead)).toMatchObject({ bpjsSyncStatus: 'dead', bpjsErrorCode: 'BPJS_DLQ' });
    expect((await outboxMsg(BPJS_ANTREAN_ADD_OPERATION, dead)).lastError).toMatch(/bpjs\.contact_phone/);

    await setContactPhone('0215550123');
    try {
      const id = await bookJkn({ phone: null });
      await dispatch();
      expect(await appointment(id)).toMatchObject({ bpjsSyncStatus: 'sent', bpjsErrorCode: null });
      const added = mockState.bpjs.antrean.get((await appointment(id)).bookingCode);
      expect(added?.request.nohp).toBe('62215550123');
      // Pasien yang punya no. HP tetap memakai miliknya.
      const own = await bookJkn();
      await dispatch();
      const ownAdded = mockState.bpjs.antrean.get((await appointment(own)).bookingCode);
      expect(ownAdded?.request.nohp).toMatch(/^6281200\d{6}$/);
    } finally {
      await setContactPhone('');
    }
  });
});

describe('job booking', () => {
  it('no-show: booking tanpa check-in sampai akhir hari → no_show + nomor poli batal; idempoten', async () => {
    const id = await bookJkn();
    const date = (await appointment(id)).appointmentDate.toISOString().slice(0, 10);
    const endOfDay = new Date(`${date}T23:30:00+07:00`);
    const ctx = { tenantId: T, now: endOfDay, tx: run };
    await bookingNoShowJob.run(ctx);
    await bookingNoShowJob.run(ctx);
    expect((await appointment(id)).status).toBe('no_show');
    const ticket = await run((tx) => tx.queueTicket.findFirstOrThrow({ where: { appointmentId: id } }));
    expect(ticket.status).toBe('cancelled');
    // Booking JKN: satu task 99 (job terulang aman) dengan waktu = saat job, diantrekan ke updatewaktu.
    const tasks = await run((tx) => tx.bpjsQueueTask.findMany({ where: { appointmentId: id } }));
    expect(tasks.map((t) => [t.taskId, t.occurredAt.toISOString(), t.status])).toEqual([
      [99, endOfDay.toISOString(), 'pending'],
    ]);
    expect(tasks[0]?.outboxMessageId).not.toBeNull();
  });

  it('pengingat H-1: satu pesan per booking (job terulang aman), terkirim ke WhatsApp tanpa poli/dokter', async () => {
    const id = await bookJkn();
    const date = (await appointment(id)).appointmentDate.toISOString().slice(0, 10);
    const dayBefore = new Date(new Date(`${date}T18:00:00+07:00`).getTime() - DAY);
    const ctx = { tenantId: T, now: dayBefore, tx: run };
    await bookingReminderJob.run(ctx);
    await bookingReminderJob.run(ctx);
    const msgs = await run((tx) =>
      tx.outboxMessage.findMany({
        where: {
          operation: PATIENT_WHATSAPP_BOOKING_REMINDER_OPERATION,
          payload: { equals: { appointmentId: id } },
        },
      }),
    );
    expect(msgs).toHaveLength(1);
    await dispatch();
    expect((await outboxMsg(PATIENT_WHATSAPP_BOOKING_REMINDER_OPERATION, id)).status).toBe('sent');
    const a = await appointment(id);
    const sent = mockState.messages.find((m) => m.text?.includes(a.bookingCode));
    expect(sent?.text).toContain('Pengingat kunjungan');
    expect(sent?.text).not.toMatch(/Penyakit Dalam|Andini|dr\./);
  });
});
