/**
 * Infrastruktur outbox fase 2 (potongan 1a): kebijakan retry per operasi (sampai akhir hari layanan WIB),
 * penundaan tanpa menghabiskan percobaan (`defer`), dan hook `onDead` yang atomik dengan perpindahan ke DLQ.
 * Operasi uji ditambahkan ke peta operasi; target = stub HTTP lokal; setiap tes memakai tenant fiktif baru.
 */
import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TestingModule } from '@nestjs/testing';
import {
  createPrismaClient,
  enqueueOutbox,
  type OutboxMessage,
  type PrismaClient,
  type TenantTx,
} from '@simrs/db';
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '../src/config/env';
import { type OutboxOperation, PermanentOperationError, SERVICE_DAY_RETRY } from '../src/outbox/operations';
import { MIN_DEFER_MS, OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { freshTenant, loadTestEnvFile, tenantDb, testEnv, testModule } from './helpers';

let stub: Server;
let stubStatus = 200;
const received: string[] = [];
let env: WorkerEnv;
let ref: TestingModule;
let db: PrismaClient;
let dispatcher: OutboxDispatcher;
/** `test.defer` meminta tunda sampai waktu ini selama nilainya > 0. */
let deferUntil = 0;

/** Bukti efek domain: baris audit `system` (tabel bertenant yang boleh disisipi aplikasi). */
async function mark(tx: TenantTx, msg: OutboxMessage, what: string, extra: Record<string, unknown> = {}) {
  await tx.auditEvent.create({
    data: {
      id: newId(),
      tenantId: msg.tenantId,
      actorRole: 'system',
      resourceType: 'outbox_uji',
      resourceId: msg.id,
      action: 'update',
      details: { what, ...extra },
    },
  });
}

const http = (key: string) => ({ method: 'POST' as const, path: `/satusehat/_echo?k=${key}` });

const onDeadMark: OutboxOperation['onDead'] = async (tx, msg) => {
  await mark(tx, msg, 'dead', { lastError: msg.lastError });
  if ((msg.payload as { throwOnDead?: boolean }).throwOnDead) throw new Error('domain menolak');
};

const OPS: Record<string, OutboxOperation> = {
  'test.http': { prepare: (msg) => http(msg.idempotencyKey), onDead: onDeadMark },
  'test.max2': { prepare: (msg) => http(msg.idempotencyKey), retry: { maxAttempts: 2 }, onDead: onDeadMark },
  'test.service-day': {
    prepare: (msg) => http(msg.idempotencyKey),
    retry: SERVICE_DAY_RETRY,
    onDead: onDeadMark,
  },
  'test.defer': {
    prepare: (msg) =>
      deferUntil > 0
        ? { defer: { untilMs: deferUntil, reason: 'menunggu jam kirim' } }
        : http(msg.idempotencyKey),
  },
  'test.defer-service-day': {
    retry: SERVICE_DAY_RETRY,
    prepare: () => ({ defer: { untilMs: Date.parse('2099-01-01T00:00:00Z'), reason: 'menunggu lama' } }),
    onDead: onDeadMark,
  },
  /** Pola task ID BPJS: tunggu pesan prasyarat (dicari lewat kuncinya) terkirim dulu. */
  'test.after': {
    async prepare(msg, ctx) {
      const { after } = msg.payload as { after: string };
      const dep = await ctx.findMessage({ target: 'satusehat', idempotencyKey: after });
      if (dep && dep.status !== 'sent') return { defer: { afterMessageId: dep.id } };
      return http(msg.idempotencyKey);
    },
    onDead: onDeadMark,
  },
  'test.bad-response': {
    prepare: (msg) => http(msg.idempotencyKey),
    async onSuccess(tx, msg) {
      await mark(tx, msg, 'success-partial');
      throw new PermanentOperationError('Respons uji tidak dikenali');
    },
    onDead: onDeadMark,
  },
};

beforeAll(async () => {
  loadTestEnvFile();
  stub = createServer((req, res) => {
    received.push(new URL(req.url ?? '/', 'http://x').searchParams.get('k') ?? '');
    req.resume();
    res.writeHead(stubStatus, { 'content-type': 'application/json' }).end('{"received":true}');
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  env = testEnv({ MOCK_BASE_URL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}` });
  ref = await testModule(env, { operations: OPS });
  dispatcher = ref.get(OutboxDispatcher);
  db = createPrismaClient({ connectionString: env.DATABASE_URL, max: 2 });
});

afterAll(async () => {
  await ref?.close();
  await db?.$disconnect();
  await new Promise<void>((r) => stub.close(() => r()));
});

beforeEach(() => {
  stubStatus = 200;
  received.length = 0;
  deferUntil = 0;
});

async function setup() {
  const T = await freshTenant();
  const run = tenantDb(db, T);
  const enqueue = (operation: string, payload: Record<string, unknown> = {}, key = `k-${newId()}`) =>
    run((tx) => enqueueOutbox(tx, T, { target: 'satusehat', operation, idempotencyKey: key, payload }));
  const get = (id: string) => run((tx) => tx.outboxMessage.findUniqueOrThrow({ where: { id } }));
  const attempts = (id: string) => run((tx) => tx.deliveryAttempt.count({ where: { outboxMessageId: id } }));
  const marks = (id: string) =>
    run((tx) => tx.auditEvent.findMany({ where: { resourceType: 'outbox_uji', resourceId: id } }));
  const dispatch = (now?: Date, maxAttempts?: number) =>
    dispatcher.dispatchOnce({ tenantIds: [T], now, maxAttempts });
  /** Urutan klaim = `created_at`; dua pesan yang dibuat di milidetik yang sama dibuat pasti berurutan. */
  const olderThan = async (firstId: string, secondId: string) => {
    const second = await get(secondId);
    await run((tx) =>
      tx.outboxMessage.update({
        where: { id: firstId },
        data: { createdAt: new Date(second.createdAt.getTime() - 1000) },
      }),
    );
  };
  return { T, run, enqueue, get, attempts, marks, dispatch, olderThan };
}

describe('defer: tunda tanpa menghabiskan percobaan', () => {
  it('untilMs: pesan kembali pending sampai waktunya, percobaan dan delivery_attempts tetap 0', async () => {
    const t = await setup();
    const msg = await t.enqueue('test.defer');
    const now = new Date(Date.now() + 1000);
    deferUntil = now.getTime() + 60_000;
    const s1 = await t.dispatch(now);
    expect(s1).toMatchObject({ claimed: 1, deferred: 1, sent: 0, failed: 0, dead: 0 });
    const m1 = await t.get(msg.id);
    expect(m1).toMatchObject({ status: 'pending', attempts: 0, lastError: 'ditunda: menunggu jam kirim' });
    expect(m1.nextAttemptAt.getTime()).toBe(deferUntil);
    expect(await t.attempts(msg.id)).toBe(0);
    expect(received).toEqual([]);

    // Ditunda berkali-kali pun tidak pernah mendekati batas percobaan.
    for (let i = 0; i < 10; i++) {
      deferUntil += 1000;
      await t.dispatch(new Date(deferUntil - 1000));
    }
    expect((await t.get(msg.id)).attempts).toBe(0);

    deferUntil = 0;
    const s2 = await t.dispatch(new Date(Date.now() + 120_000));
    expect(s2.sent).toBe(1);
    expect(await t.get(msg.id)).toMatchObject({ status: 'sent', attempts: 1, lastError: null });
    expect(await t.attempts(msg.id)).toBe(1);
  });

  it('untilMs di masa lalu tidak membuat putaran tanpa jeda (minimal MIN_DEFER_MS)', async () => {
    const t = await setup();
    const msg = await t.enqueue('test.defer');
    const now = new Date(Date.now() + 1000);
    deferUntil = 1;
    await t.dispatch(now);
    expect((await t.get(msg.id)).nextAttemptAt.getTime()).toBe(now.getTime() + MIN_DEFER_MS);
  });

  it('afterMessageId: menunggu prasyarat yang gagal, lalu terkirim berurutan setelah prasyarat terkirim', async () => {
    const t = await setup();
    stubStatus = 503;
    const first = await t.enqueue('test.http', {}, 'task-1');
    const second = await t.enqueue('test.after', { after: 'task-1' }, 'task-2');
    await t.olderThan(first.id, second.id);
    const now = new Date(Date.now() + 1000);
    const s1 = await t.dispatch(now);
    expect(s1).toMatchObject({ failed: 1, deferred: 1 });
    const dep = await t.get(first.id);
    const waiting = await t.get(second.id);
    expect(waiting).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: `ditunda: menunggu pesan ${first.id}`,
    });
    expect(waiting.nextAttemptAt.getTime()).toBe(dep.nextAttemptAt.getTime() + MIN_DEFER_MS);
    expect(received).toEqual(['task-1']);

    stubStatus = 200;
    received.length = 0;
    const s2 = await t.dispatch(waiting.nextAttemptAt);
    expect(s2.sent).toBe(2);
    expect(received).toEqual(['task-1', 'task-2']);
    expect(await t.get(second.id)).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('afterMessageId: prasyarat masuk DLQ → pesan ikut DLQ (urutan tidak mungkin dipenuhi) dan onDead dipanggil', async () => {
    const t = await setup();
    stubStatus = 400;
    const first = await t.enqueue('test.http', {}, 'task-1');
    const second = await t.enqueue('test.after', { after: 'task-1' }, 'task-2');
    await t.olderThan(first.id, second.id);
    const s = await t.dispatch(new Date(Date.now() + 1000));
    expect(s.dead).toBe(2);
    expect(received).toEqual(['task-1']);
    const m = await t.get(second.id);
    expect(m).toMatchObject({ status: 'dead', lastError: `Pesan prasyarat ${first.id} masuk DLQ` });
    expect(await t.marks(second.id)).toHaveLength(1);
  });

  it('penundaan tidak tanpa ujung: lewat umur maksimum (bawaan 24 jam dari saat dibuat) → DLQ', async () => {
    const t = await setup();
    const msg = await t.enqueue('test.defer');
    const now = new Date(Date.now() + 1000);
    deferUntil = msg.createdAt.getTime() + 24 * 60 * 60_000 - 1;
    await t.dispatch(now);
    expect((await t.get(msg.id)).status).toBe('pending');
    deferUntil = msg.createdAt.getTime() + 24 * 60 * 60_000;
    await t.dispatch(new Date(deferUntil - 1));
    expect(await t.get(msg.id)).toMatchObject({
      status: 'dead',
      attempts: 1,
      lastError: 'ditunda melewati batas waktu coba ulang: menunggu jam kirim',
    });
  });

  it('penundaan yang melewati batas hari layanan → DLQ', async () => {
    const t = await setup();
    const msg = await t.enqueue('test.defer-service-day');
    await t.dispatch(new Date(Date.now() + 1000));
    expect(await t.get(msg.id)).toMatchObject({
      status: 'dead',
      lastError: 'ditunda melewati batas waktu coba ulang: menunggu lama',
    });
    expect(await t.marks(msg.id)).toHaveLength(1);
  });
});

describe('onDead: atomik dengan perpindahan ke DLQ', () => {
  it('galat permanen → DLQ + efek domain onDead tercatat (melihat lastError)', async () => {
    const t = await setup();
    stubStatus = 400;
    const msg = await t.enqueue('test.http');
    await t.dispatch(new Date(Date.now() + 1000));
    expect(await t.get(msg.id)).toMatchObject({ status: 'dead', lastError: 'HTTP 400' });
    const marks = await t.marks(msg.id);
    expect(marks.map((m) => m.details)).toEqual([{ what: 'dead', lastError: 'HTTP 400' }]);
  });

  it('pesan yang masih dicoba ulang tidak memanggil onDead', async () => {
    const t = await setup();
    stubStatus = 503;
    const msg = await t.enqueue('test.http');
    await t.dispatch(new Date(Date.now() + 1000));
    expect((await t.get(msg.id)).status).toBe('failed');
    expect(await t.marks(msg.id)).toEqual([]);
  });

  it('onDead melempar → perubahan domain dibatalkan, pesan tetap DLQ dengan catatan', async () => {
    const t = await setup();
    stubStatus = 400;
    const msg = await t.enqueue('test.http', { throwOnDead: true });
    const s = await t.dispatch(new Date(Date.now() + 1000));
    expect(s.dead).toBe(1);
    expect(await t.get(msg.id)).toMatchObject({
      status: 'dead',
      lastError: 'HTTP 400 · onDead gagal: Error',
    });
    expect(await t.marks(msg.id)).toEqual([]);
    expect(await t.attempts(msg.id)).toBe(1);
  });

  it('onSuccess melempar → efeknya dibatalkan, percobaan gagal permanen, onDead tetap dipanggil', async () => {
    const t = await setup();
    const msg = await t.enqueue('test.bad-response');
    await t.dispatch(new Date(Date.now() + 1000));
    expect(await t.get(msg.id)).toMatchObject({ status: 'dead', lastError: 'Respons uji tidak dikenali' });
    const marks = await t.marks(msg.id);
    expect(marks.map((m) => (m.details as { what: string }).what)).toEqual(['dead']);
  });
});

describe('kebijakan retry per operasi', () => {
  it('maxAttempts operasi mengalahkan bawaan 8', async () => {
    const t = await setup();
    stubStatus = 503;
    const msg = await t.enqueue('test.max2');
    let now = new Date(Date.now() + 1000);
    await t.dispatch(now);
    const m1 = await t.get(msg.id);
    expect(m1.status).toBe('failed');
    now = new Date(m1.nextAttemptAt.getTime() + 1);
    await t.dispatch(now);
    expect(await t.get(msg.id)).toMatchObject({ status: 'dead', attempts: 2 });
    expect(await t.marks(msg.id)).toHaveLength(1);
  });

  it('operasi tanpa kebijakan tetap memakai batas bawaan/opsi dispatch (perilaku lama)', async () => {
    const t = await setup();
    stubStatus = 503;
    const msg = await t.enqueue('test.http');
    await t.dispatch(new Date(Date.now() + 1000), 1);
    expect(await t.get(msg.id)).toMatchObject({ status: 'dead', attempts: 1, lastError: 'HTTP 503' });
  });

  it('sampai akhir hari layanan WIB: batas 00.00 WIB dihitung dari saat pesan dibuat', async () => {
    const t = await setup();
    stubStatus = 503;
    const due = new Date('2026-10-05T17:00:00Z'); // 6 Okt 00.00 WIB
    const lastSecond = await t.enqueue('test.service-day'); // dibuat 5 Okt 23.59.59 WIB
    const firstSecond = await t.enqueue('test.service-day'); // dibuat 6 Okt 00.00.00 WIB
    await t.run(async (tx) => {
      await tx.outboxMessage.update({
        where: { id: lastSecond.id },
        data: { createdAt: new Date('2026-10-05T16:59:59Z'), nextAttemptAt: due },
      });
      await tx.outboxMessage.update({
        where: { id: firstSecond.id },
        data: { createdAt: due, nextAttemptAt: due },
      });
    });
    await t.dispatch(new Date('2026-10-05T17:00:30Z'));
    expect(await t.get(lastSecond.id)).toMatchObject({
      status: 'dead',
      attempts: 1,
      lastError: 'HTTP 503 · batas waktu coba ulang terlewati',
    });
    expect(await t.marks(lastSecond.id)).toHaveLength(1);
    expect(await t.get(firstSecond.id)).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('sampai akhir hari layanan: tidak dibatasi hitungan percobaan; jeda dibatasi 10 menit', async () => {
    const t = await setup();
    stubStatus = 503;
    const msg = await t.enqueue('test.service-day');
    const now = new Date('2026-10-05T03:00:00Z'); // 5 Okt 10.00 WIB
    await t.run((tx) =>
      tx.outboxMessage.update({
        where: { id: msg.id },
        data: { createdAt: new Date('2026-10-05T01:00:00Z'), nextAttemptAt: now, attempts: 30 },
      }),
    );
    await t.dispatch(now, 3);
    const m = await t.get(msg.id);
    expect(m).toMatchObject({ status: 'failed', attempts: 31 });
    expect(m.nextAttemptAt.getTime() - now.getTime()).toBeLessThanOrEqual(10 * 60_000);
    expect(m.nextAttemptAt.getTime() - now.getTime()).toBeGreaterThanOrEqual(5 * 60_000);
  });
});
