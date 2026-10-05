/**
 * F04 · `bpjs.antrean.updatewaktu` terhadap mock BPJS sungguhan: urutan task 1→2→3 tetap terjaga walau mock lambat/
 * menahan respons (task berikutnya `defer` menunggu pesan task sebelumnya, tanpa menghabiskan percobaan), waktu yang
 * dikirim = waktu event, penolakan tercatat sebagai `rejected` + kode, DLQ → `dead`. Baris task + outbox disusun
 * persis seperti mesin task ID API (`BpjsTaskEngine`).
 */
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { TestingModule } from '@nestjs/testing';
import {
  createPrismaClient,
  enqueueOutbox,
  insertPatient,
  type PrismaClient,
  type TenantTx,
  toDbDate,
} from '@simrs/db';
import {
  BPJS_ANTREAN_ADD_OPERATION,
  BPJS_ANTREAN_UPDATEWAKTU_OPERATION,
  isoDateJakarta,
  newId,
  outboxKey,
} from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../mock/src/config';
import { buildServer } from '../../mock/src/server';
import { MockState } from '../../mock/src/state';
import type { WorkerEnv } from '../src/config/env';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { freshTenant, loadTestEnvFile, tenantDb, testEnv, testModule } from './helpers';

let mock: ReturnType<typeof buildServer>;
let mockState: MockState;
let env: WorkerEnv;
let ref: TestingModule;
let db: PrismaClient;
let dispatcher: OutboxDispatcher;
let T: string;
let fixture: { serviceId: string; practitionerId: string; sessionId: string };
let crypto: PatientCrypto;

const run = <R>(fn: (tx: TenantTx) => Promise<R>) => tenantDb(db, T)(fn);

beforeAll(async () => {
  loadTestEnvFile();
  mockState = new MockState();
  mock = buildServer({ ...loadConfig({}), port: 0 }, mockState);
  await mock.listen({ port: 0, host: '127.0.0.1' });
  env = testEnv({
    BPJS_BASE_URL: `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}/bpjs`,
    OUTBOX_HTTP_TIMEOUT_MS: '1000',
  });
  ref = await testModule(env);
  dispatcher = ref.get(OutboxDispatcher);
  db = createPrismaClient({ connectionString: env.DATABASE_URL, max: 2 });
  T = await freshTenant('Uji Antrean BPJS');
  crypto = new PatientCrypto({ encKeyB64: env.FIELD_ENCRYPTION_KEY, hashKeyB64: env.FIELD_HASH_KEY }, T);
  fixture = await tenantDb(
    db,
    T,
  )(async (tx) => {
    const serviceId = newId();
    await tx.queueService.create({
      data: { id: serviceId, tenantId: T, code: 'PD', name: 'Penyakit Dalam', kind: 'poli' },
    });
    const practitionerId = newId();
    await tx.practitioner.create({ data: { id: practitionerId, tenantId: T, name: 'dr. Uji, Sp.PD' } });
    const sessionId = newId();
    await tx.scheduleSession.create({
      data: {
        id: sessionId,
        tenantId: T,
        practitionerId,
        serviceId,
        sessionDate: toDbDate(isoDateJakarta()),
        startTime: new Date('1970-01-01T00:00:00Z'),
        endTime: new Date('1970-01-01T23:00:00Z'),
        quotaJkn: 10,
        quotaNonJkn: 2,
      },
    });
    return { serviceId, practitionerId, sessionId };
  });
});

afterAll(async () => {
  await ref?.close();
  await db?.$disconnect();
  await mock?.close();
});

beforeEach(() => mockState.reset());

/** Booking JKN + (opsional) antrean yang sudah ditambahkan ke mock. */
async function booking(inMock = true) {
  const id = newId();
  const bookingCode = String(Math.floor(Math.random() * 9e9) + 1e9);
  // Satu booking aktif per pasien × layanan × hari: pasien baru per booking.
  const patientId = await run(
    async (tx) =>
      (await insertPatient(tx, crypto, { name: 'Pasien Uji', sex: 'male', birthDate: '1970-01-01' })).id,
  );
  await run((tx) =>
    tx.appointment.create({
      data: {
        id,
        tenantId: T,
        bookingCode,
        patientId,
        sessionId: fixture.sessionId,
        practitionerId: fixture.practitionerId,
        serviceId: fixture.serviceId,
        appointmentDate: toDbDate(isoDateJakarta()),
        quotaBucket: 'jkn',
        channel: 'loket',
        jknVisitKind: 1,
        referenceNumber: '9999P0011025Y000001',
      },
    }),
  );
  if (inMock) {
    mockState.bpjs.antrean.set(bookingCode, {
      kodebooking: bookingCode,
      request: {} as never,
      status: 'aktif',
      dibuat: new Date().toISOString(),
      tasks: [],
      batal: null,
    });
  }
  return { id, bookingCode };
}

/** Seperti `BpjsTaskEngine.insertTask`: baris task + pesan outbox (payload ID saja) di satu transaksi. */
async function task(appointmentId: string, taskId: number, at: Date) {
  return run(async (tx) => {
    const id = newId();
    await tx.bpjsQueueTask.create({ data: { id, tenantId: T, appointmentId, taskId, occurredAt: at } });
    const msg = await enqueueOutbox(tx, T, {
      target: 'bpjs',
      operation: BPJS_ANTREAN_UPDATEWAKTU_OPERATION,
      idempotencyKey: outboxKey(BPJS_ANTREAN_UPDATEWAKTU_OPERATION, id),
      payload: { queueTaskId: id },
    });
    await tx.bpjsQueueTask.update({ where: { id }, data: { outboxMessageId: msg.id } });
    return { id, messageId: msg.id };
  });
}

const rows = (appointmentId: string) =>
  run((tx) => tx.bpjsQueueTask.findMany({ where: { appointmentId }, orderBy: { taskId: 'asc' } }));

/** Putaran dispatch dengan jam maju sampai semua pesan selesai (atau batas putaran). */
async function drain(appointmentId: string, maxRounds = 20) {
  let now = new Date(Date.now() + 1000);
  for (let i = 0; i < maxRounds; i++) {
    await dispatcher.dispatchOnce({ tenantIds: [T], now });
    const pending = await run((tx) =>
      tx.outboxMessage.findMany({
        where: { status: { in: ['pending', 'failed'] } },
        select: { nextAttemptAt: true },
      }),
    );
    const mine = (await rows(appointmentId)).filter((r) => r.status === 'pending');
    if (mine.length === 0 || pending.length === 0) return;
    now = new Date(Math.max(...pending.map((p) => p.nextAttemptAt.getTime())) + 1);
  }
}

describe('bpjs.antrean.updatewaktu', () => {
  it('urutan 1→2→3 terjaga walau mock menahan respons: task berikutnya ditunda, waktu = waktu event', async () => {
    const b = await booking();
    const t0 = Date.now() - 60_000;
    const at = [new Date(t0), new Date(t0 + 7_000), new Date(t0 + 15_000)];
    const t1 = await task(b.id, 1, at[0]!);
    const t2 = await task(b.id, 2, at[1]!);
    const t3 = await task(b.id, 3, at[2]!);

    // Mock menahan jawaban (permintaan tetap diproses) lebih lama dari batas waktu konektor (1 dtk).
    mockState.scenarios.set('bpjs', { ...mockState.scenario('bpjs'), mode: 'timeout', timeoutMs: 3_000 });
    const s1 = await dispatcher.dispatchOnce({ tenantIds: [T], now: new Date(Date.now() + 1000) });
    expect(s1).toMatchObject({ failed: 1, deferred: 2 });
    const m = await run((tx) =>
      tx.outboxMessage.findMany({ where: { id: { in: [t1.messageId, t2.messageId, t3.messageId] } } }),
    );
    const byId = new Map(m.map((x) => [x.id, x]));
    expect(byId.get(t1.messageId)).toMatchObject({
      status: 'failed',
      lastError: 'BPJS_UNAVAILABLE: timeout',
    });
    expect(byId.get(t2.messageId)).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: 'ditunda: menunggu task 1',
    });
    expect(byId.get(t3.messageId)).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: 'ditunda: menunggu task 2',
    });

    // Mock pulih: task 1 dikirim ulang (BPJS sudah mencatatnya → TASK_GANDA = terkirim), lalu 2 dan 3 berurutan.
    mockState.scenarios.set('bpjs', { ...mockState.scenario('bpjs'), mode: 'normal' });
    await drain(b.id);
    const recorded = mockState.bpjs.antrean.get(b.bookingCode)?.tasks ?? [];
    expect(recorded.map((t) => [t.taskid, t.waktu])).toEqual(at.map((d, i) => [i + 1, d.getTime()]));
    expect((await rows(b.id)).map((r) => [r.taskId, r.status, r.lastErrorCode])).toEqual([
      [1, 'sent', null],
      [2, 'sent', null],
      [3, 'sent', null],
    ]);
  });

  it('mock lambat: pesan yang diklaim bersamaan tetap terkirim berurutan', async () => {
    const b = await booking();
    const t0 = Date.now() - 30_000;
    await task(b.id, 1, new Date(t0));
    await task(b.id, 2, new Date(t0 + 1_000));
    await task(b.id, 3, new Date(t0 + 2_000));
    mockState.scenarios.set('bpjs', { ...mockState.scenario('bpjs'), mode: 'lambat', latencyMs: 300 });
    await drain(b.id);
    expect((mockState.bpjs.antrean.get(b.bookingCode)?.tasks ?? []).map((t) => t.taskid)).toEqual([1, 2, 3]);
  });

  it('penolakan BPJS → `rejected` + kode (pesan terkirim, bukan DLQ); task berikutnya tidak menunggu yang ditolak', async () => {
    const b = await booking(false); // antrean belum ada di BPJS
    const t1 = await task(b.id, 1, new Date(Date.now() - 10_000));
    await drain(b.id);
    expect((await rows(b.id))[0]).toMatchObject({
      status: 'rejected',
      lastErrorCode: 'BPJS_ANTREAN_TIDAK_DITEMUKAN',
    });
    expect(
      await run((tx) => tx.outboxMessage.findUniqueOrThrow({ where: { id: t1.messageId } })),
    ).toMatchObject({
      status: 'sent',
    });
    await task(b.id, 3, new Date(Date.now() - 5_000));
    await drain(b.id);
    expect((await rows(b.id)).map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });

  it('tambah antrean belum diterima (gangguan BPJS, dicoba ulang) → task menunggu tambah, lalu terkirim', async () => {
    const b = await booking(false);
    // Seperti booking JKN setelah gangguan: status kirim `pending`, pesan tambah gagal dan menunggu percobaan ulang.
    const add = await run(async (tx) => {
      await tx.appointment.update({ where: { id: b.id }, data: { bpjsSyncStatus: 'pending' } });
      const msg = await enqueueOutbox(tx, T, {
        target: 'bpjs',
        operation: BPJS_ANTREAN_ADD_OPERATION,
        idempotencyKey: outboxKey(BPJS_ANTREAN_ADD_OPERATION, b.id),
        payload: { appointmentId: b.id },
      });
      return tx.outboxMessage.update({
        where: { id: msg.id },
        data: { status: 'failed', attempts: 1, nextAttemptAt: new Date(Date.now() + 3_600_000) },
      });
    });
    const t1 = await task(b.id, 1, new Date(Date.now() - 10_000));
    await dispatcher.dispatchOnce({ tenantIds: [T], now: new Date(Date.now() + 1000) });
    expect(
      await run((tx) => tx.outboxMessage.findUniqueOrThrow({ where: { id: t1.messageId } })),
    ).toMatchObject({ status: 'pending', attempts: 0, lastError: 'ditunda: menunggu tambah antrean' });
    expect((await rows(b.id))[0]?.status).toBe('pending');

    // Tambah antrean diterima BPJS → task dikirim.
    await run(async (tx) => {
      await tx.outboxMessage.update({ where: { id: add.id }, data: { status: 'sent', sentAt: new Date() } });
      await tx.appointment.update({
        where: { id: b.id },
        data: { bpjsSyncStatus: 'sent', bpjsSyncedAt: new Date() },
      });
    });
    mockState.bpjs.antrean.set(b.bookingCode, {
      kodebooking: b.bookingCode,
      request: {} as never,
      status: 'aktif',
      dibuat: new Date().toISOString(),
      tasks: [],
      batal: null,
    });
    await drain(b.id);
    expect((await rows(b.id)).map((r) => r.status)).toEqual(['sent']);
  });

  it('DLQ (kredensial ditolak) → task `dead` dengan kode galat', async () => {
    const b = await booking();
    const t1 = await task(b.id, 1, new Date(Date.now() - 10_000));
    const wrong = await testModule({ ...env, BPJS_USER_KEY: 'bukan-user-key' });
    try {
      await wrong.get(OutboxDispatcher).dispatchOnce({ tenantIds: [T], now: new Date(Date.now() + 1000) });
    } finally {
      await wrong.close();
    }
    expect(
      await run((tx) => tx.outboxMessage.findUniqueOrThrow({ where: { id: t1.messageId } })),
    ).toMatchObject({
      status: 'dead',
    });
    expect((await rows(b.id))[0]).toMatchObject({ status: 'dead', lastErrorCode: 'BPJS_AUTH' });
  });
});
