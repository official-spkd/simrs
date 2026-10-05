/**
 * Definisi selesai fase 0: "Pesan outbox contoh terkirim ke mock; bila mock diset gagal → retry → DLQ".
 * Target HTTP adalah stub lokal yang perilakunya diatur per tes; DB = simrs_test (role simrs_app).
 */
import 'reflect-metadata';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createPrismaClient, enqueueOutbox, type PrismaClient, withTenant } from '@simrs/db';
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadWorkerEnv, WORKER_ENV, type WorkerEnv } from '../src/config/env';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { OUTBOX_QUEUE, OutboxScheduler } from '../src/outbox/outbox.scheduler';
import { WorkerModule } from '../src/worker.module';
import { freshTenant } from './helpers';

/**
 * Tenant fiktif baru per run, bukan tenant seed: di tenant seed, pesan sisa tes API (database tes tanpa worker)
 * menumpuk dan bisa mendorong pesan tes ini keluar batch klaim (`OUTBOX_BATCH_SIZE`), sehingga tes gagal sesekali.
 */
let A = '';
let B = '';

let stub: Server;
let stubStatus = 200;
const received: Array<{ path: string; key: string | undefined }> = [];
let env: WorkerEnv;
let db: PrismaClient;
let dispatcher: OutboxDispatcher;
let scheduler: OutboxScheduler;

beforeAll(async () => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // opsional
  }
  A = await freshTenant('Outbox A');
  B = await freshTenant('Outbox B');
  stub = createServer((req: IncomingMessage, res) => {
    received.push({ path: req.url ?? '', key: req.headers['idempotency-key'] as string | undefined });
    req.resume();
    res.writeHead(stubStatus, { 'content-type': 'application/json' }).end('{"received":true}');
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  const port = (stub.address() as AddressInfo).port;

  env = loadWorkerEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL:
      process.env.TEST_APP_DATABASE_URL ??
      'postgresql://simrs_app:app_local@localhost:5432/simrs_test?schema=public',
    MOCK_BASE_URL: `http://127.0.0.1:${port}`,
    OUTBOX_POLL_MS: '300',
    OUTBOX_HTTP_TIMEOUT_MS: '2000',
    // Redis dipakai bersama worker pengembangan dan salinan repo lain: antrean tes memakai prefiks sendiri.
    BULLMQ_PREFIX: `bull-test-${newId()}`,
  });
  const ref = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(WORKER_ENV)
    .useValue(env)
    .compile();
  await ref.init();
  dispatcher = ref.get(OutboxDispatcher);
  scheduler = ref.get(OutboxScheduler);
  db = createPrismaClient({ connectionString: env.DATABASE_URL, max: 2 });
});

afterAll(async () => {
  await scheduler?.onModuleDestroy();
  await obliterateTestQueue();
  await dispatcher?.onModuleDestroy();
  await db?.$disconnect();
  await new Promise<void>((r) => stub.close(() => r()));
});

beforeEach(() => {
  stubStatus = 200;
  received.length = 0;
});

async function enqueue(tenantId: string, target: 'satusehat' | 'bpjs' = 'satusehat', operation = 'ping') {
  return withTenant(db, tenantId, (tx) =>
    enqueueOutbox(tx, tenantId, { target, operation, idempotencyKey: `t-${newId()}`, payload: { n: 1 } }),
  );
}

async function status(tenantId: string, id: string) {
  return withTenant(db, tenantId, (tx) => tx.outboxMessage.findUniqueOrThrow({ where: { id } }));
}

describe('dispatcher', () => {
  it('mengirim pesan semua tenant ke target dengan Idempotency-Key', async () => {
    const a = await enqueue(A);
    const b = await enqueue(B, 'bpjs');
    const summary = await dispatcher.dispatchOnce({ tenantIds: [A, B] });
    expect(summary.sent).toBeGreaterThanOrEqual(2);
    expect((await status(A, a.id)).status).toBe('sent');
    expect((await status(B, b.id)).status).toBe('sent');
    expect(received).toEqual(
      expect.arrayContaining([
        { path: '/satusehat/_echo', key: a.idempotencyKey },
        { path: '/bpjs/_echo', key: b.idempotencyKey },
      ]),
    );
  });

  it('target gagal (503) → retry eksponensial → DLQ setelah batas percobaan', async () => {
    stubStatus = 503;
    const msg = await enqueue(A);
    let now = new Date(Date.now() + 1000);
    for (let i = 1; i <= 3; i++) {
      await dispatcher.dispatchOnce({ tenantIds: [A, B], now, maxAttempts: 3 });
      const s = await status(A, msg.id);
      expect(s.attempts).toBe(i);
      if (i < 3) {
        expect(s.status).toBe('failed');
        expect(s.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
        now = new Date(s.nextAttemptAt.getTime() + 1);
      } else {
        expect(s.status).toBe('dead');
        expect(s.lastError).toBe('HTTP 503');
      }
    }
  });

  it('galat permanen (400) langsung DLQ tanpa retry', async () => {
    stubStatus = 400;
    const msg = await enqueue(A);
    await dispatcher.dispatchOnce({ tenantIds: [A, B] });
    const s = await status(A, msg.id);
    expect(s.status).toBe('dead');
    expect(s.attempts).toBe(1);
  });

  it('operasi yang belum didukung (termasuk nama properti bawaan) langsung DLQ tanpa memanggil target', async () => {
    const proto = await enqueue(A, 'satusehat', 'constructor');
    const msg = await enqueue(A, 'satusehat', 'Encounter.create');
    await dispatcher.dispatchOnce({ tenantIds: [A, B] });
    expect((await status(A, msg.id)).status).toBe('dead');
    expect(received.find((r) => r.key === msg.idempotencyKey)).toBeUndefined();
    expect((await status(A, proto.id)).status).toBe('dead');
  });

  it('target pulih: pesan yang gagal terkirim pada putaran berikutnya', async () => {
    stubStatus = 503;
    const msg = await enqueue(A);
    const t1 = new Date(Date.now() + 1000);
    await dispatcher.dispatchOnce({ tenantIds: [A, B], now: t1 });
    const failed = await status(A, msg.id);
    expect(failed.status).toBe('failed');
    stubStatus = 200;
    await dispatcher.dispatchOnce({ tenantIds: [A, B], now: new Date(failed.nextAttemptAt.getTime() + 1) });
    const s = await status(A, msg.id);
    expect(s.status).toBe('sent');
    expect(s.attempts).toBe(2);
  });
});

/** Hapus kunci antrean tes (hanya prefiks unik tes ini; tidak pernah FLUSHALL). */
async function obliterateTestQueue(): Promise<void> {
  if (!env || !(await redisUp(env.REDIS_URL))) return;
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(OUTBOX_QUEUE, { connection, prefix: env.BULLMQ_PREFIX });
  try {
    await queue.obliterate({ force: true });
  } finally {
    await queue.close();
    connection.disconnect();
  }
}

async function redisUp(url: string): Promise<boolean> {
  return assertRedisReachable(url).then(
    () => true,
    () => false,
  );
}

async function assertRedisReachable(url: string): Promise<void> {
  const probe = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 2000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  probe.on('error', () => {});
  try {
    await probe.connect();
    await probe.ping();
  } catch {
    throw new Error(
      `Redis tidak terjangkau di ${url}. Jalankan \`docker compose up -d\` (tes ini sengaja tidak dilewati).`,
    );
  } finally {
    probe.disconnect();
  }
}

describe('BullMQ scheduler (Redis)', () => {
  it('menjalankan putaran dispatch berkala sampai pesan terkirim', async () => {
    await assertRedisReachable(env.REDIS_URL);
    const msg = await enqueue(B);
    await scheduler.start();
    const deadline = Date.now() + 15_000;
    let s = await status(B, msg.id);
    while (s.status !== 'sent' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      s = await status(B, msg.id);
    }
    expect(s.status).toBe('sent');
  });
});
