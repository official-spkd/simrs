/**
 * P11 minimal · job berkala per tenant: validasi peta job, jadwal harian WIB, eksekusi per tenant (galat satu tenant
 * tidak menghentikan tenant lain, modul nonaktif dilewati), timer tanpa Redis, dan job scheduler BullMQ dengan
 * prefiks antrean unik (Redis dipakai bersama worker pengembangan).
 */
import 'reflect-metadata';
import { createPrismaClient, type PrismaClient } from '@simrs/db';
import { newId } from '@simrs/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERIODIC_JOBS, type PeriodicJob, type PeriodicJobContext } from '../src/jobs/periodic-jobs';
import {
  assertValidJobs,
  nextDailyRun,
  PERIODIC_QUEUE,
  PeriodicScheduler,
  repeatOptions,
} from '../src/jobs/periodic.scheduler';
import { freshTenant, loadTestEnvFile, tenantDb, testEnv } from './helpers';

let db: PrismaClient;

beforeAll(() => {
  loadTestEnvFile();
  db = createPrismaClient({ connectionString: testEnv().DATABASE_URL, max: 2 });
});

afterAll(async () => {
  await db?.$disconnect();
});

const noop: PeriodicJob = { schedule: { everyMs: 60_000 }, run: async () => {} };

describe('peta job berkala', () => {
  it('peta bawaan valid; nama mirip properti bawaan objek bukan job', () => {
    expect(() => assertValidJobs(PERIODIC_JOBS)).not.toThrow();
    for (const name of ['constructor', '__proto__', 'toString'])
      expect(PERIODIC_JOBS.get(name)).toBeUndefined();
  });

  it('menolak nama tanpa konteks, selang terlalu rapat/jarang, dan jam harian yang salah', () => {
    const bad: Array<[string, PeriodicJob]> = [
      ['noshow', noop],
      ['Booking.NoShow', noop],
      ['booking.no-show', { ...noop, schedule: { everyMs: 1000 } }],
      ['booking.no-show', { ...noop, schedule: { everyMs: 2 * 24 * 60 * 60_000 } }],
      ['scheduling.generate-sessions', { ...noop, schedule: { dailyAt: '1:00' } }],
      ['scheduling.generate-sessions', { ...noop, schedule: { dailyAt: '24:00' } }],
    ];
    for (const [name, job] of bad) expect(() => assertValidJobs(new Map([[name, job]]))).toThrow();
    const good = new Map<string, PeriodicJob>([
      ['scheduling.generate-sessions', { ...noop, schedule: { dailyAt: '01:00' } }],
      ['scheduling.hfis-pull', { ...noop, schedule: { everyMs: 15 * 60_000 } }],
      ['booking.no-show', { ...noop, schedule: { everyMs: 5 * 60_000 } }],
      ['booking.reminder', { ...noop, schedule: { dailyAt: '18:00' } }],
    ]);
    expect(() => assertValidJobs(good)).not.toThrow();
  });

  it('jadwal harian dihitung dalam WIB', () => {
    // 5 Okt 00.59 WIB → 5 Okt 01.00 WIB (= 4 Okt 18.00 UTC)
    expect(nextDailyRun('01:00', new Date('2026-10-04T17:59:00Z')).toISOString()).toBe(
      '2026-10-04T18:00:00.000Z',
    );
    // tepat 01.00 WIB → besok
    expect(nextDailyRun('01:00', new Date('2026-10-04T18:00:00Z')).toISOString()).toBe(
      '2026-10-05T18:00:00.000Z',
    );
    // 5 Okt 23.30 WIB → 6 Okt 18.00 WIB (= 6 Okt 11.00 UTC)
    expect(nextDailyRun('18:00', new Date('2026-10-05T16:30:00Z')).toISOString()).toBe(
      '2026-10-06T11:00:00.000Z',
    );
  });

  it('opsi repeat BullMQ: selang tetap atau cron harian ber-zona Asia/Jakarta', () => {
    expect(repeatOptions({ everyMs: 300_000 })).toEqual({ every: 300_000 });
    expect(repeatOptions({ dailyAt: '01:05' })).toEqual({ pattern: '5 1 * * *', tz: 'Asia/Jakarta' });
  });
});

describe('eksekusi per tenant', () => {
  it('sekali per tenant dengan transaksi ber-RLS; galat satu tenant tidak menghentikan yang lain', async () => {
    const [A, B] = [await freshTenant('Job A'), await freshTenant('Job B')];
    const now = new Date('2026-10-05T18:00:00Z');
    const seen: Array<{ tenantId: string; now: string; visible: number }> = [];
    const job: PeriodicJob = {
      schedule: { everyMs: 60_000 },
      async run(ctx: PeriodicJobContext) {
        if (ctx.tenantId === A) throw new Error('gagal untuk A');
        await ctx.tx((tx) =>
          tx.auditEvent.create({
            data: {
              id: newId(),
              tenantId: ctx.tenantId,
              actorRole: 'system',
              resourceType: 'job_uji',
              action: 'update',
            },
          }),
        );
        // RLS: hanya baris tenant ini yang terlihat.
        const visible = await ctx.tx((tx) => tx.auditEvent.count({ where: { resourceType: 'job_uji' } }));
        seen.push({ tenantId: ctx.tenantId, now: ctx.now.toISOString(), visible });
      },
    };
    const scheduler = new PeriodicScheduler(testEnv(), new Map([['uji.per-tenant', job]]));
    try {
      const summary = await scheduler.runJob('uji.per-tenant', { now, tenantIds: [A, B] });
      expect(summary).toEqual({ job: 'uji.per-tenant', tenants: 2, ok: 1, skipped: 0, failed: 1 });
      expect(seen).toEqual([{ tenantId: B, now: now.toISOString(), visible: 1 }]);
      expect(await tenantDb(db, A)((tx) => tx.auditEvent.count({ where: { resourceType: 'job_uji' } }))).toBe(
        0,
      );
      await expect(scheduler.runJob('uji.tidak-ada')).rejects.toThrow(/tidak dikenal/);
    } finally {
      await scheduler.onModuleDestroy();
    }
  });

  it('job bermodul dilewati untuk tenant yang modulnya nonaktif', async () => {
    const T = await freshTenant('Job modul');
    let calls = 0;
    const job: PeriodicJob = {
      schedule: { everyMs: 60_000 },
      module: 'B02', // bawaan nonaktif (bukan MVP)
      run: async () => {
        calls += 1;
      },
    };
    const scheduler = new PeriodicScheduler(testEnv(), new Map([['uji.bermodul', job]]));
    try {
      expect(await scheduler.runJob('uji.bermodul', { tenantIds: [T] })).toMatchObject({ ok: 0, skipped: 1 });
      expect(calls).toBe(0);
    } finally {
      await scheduler.onModuleDestroy();
    }
  });
});

describe('penjadwal', () => {
  it('tanpa Redis (lokal, auto) → timer; job berjalan berurutan dan berhenti saat modul ditutup', async () => {
    const T = await freshTenant('Job timer');
    let running = 0;
    let maxConcurrent = 0;
    const calls: string[] = [];
    const slow = (name: string): PeriodicJob => ({
      schedule: { everyMs: 60_000 },
      async run(ctx) {
        if (ctx.tenantId !== T) return;
        running += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        calls.push(name);
        await new Promise((r) => setTimeout(r, 150));
        running -= 1;
      },
    });
    const env = testEnv({ APP_ENV: 'local', OUTBOX_SCHEDULER: 'auto', REDIS_URL: 'redis://127.0.0.1:1' });
    const scheduler = new PeriodicScheduler(
      env,
      new Map([
        ['uji.satu', slow('uji.satu')],
        ['uji.dua', slow('uji.dua')],
      ]),
    );
    expect(await scheduler.start()).toBe('interval');
    const deadline = Date.now() + 10_000;
    while (calls.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    await scheduler.onModuleDestroy();
    expect(calls.sort()).toEqual(['uji.dua', 'uji.satu']);
    expect(maxConcurrent).toBe(1);
  });

  it('BullMQ (Redis): job scheduler per job, jadwal usang dihapus, worker menjalankan job', async () => {
    const env = testEnv();
    await assertRedisReachable(env.REDIS_URL);
    const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue(PERIODIC_QUEUE, { connection, prefix: env.BULLMQ_PREFIX });
    const T = await freshTenant('Job BullMQ');
    let ran = 0;
    const scheduler = new PeriodicScheduler(
      env,
      new Map<string, PeriodicJob>([
        [
          'uji.berkala',
          {
            schedule: { everyMs: 600_000 },
            run: async (ctx) => {
              if (ctx.tenantId === T) ran += 1;
            },
          },
        ],
        ['uji.harian', { schedule: { dailyAt: '01:00' }, run: async () => {} }],
      ]),
    );
    try {
      await queue.upsertJobScheduler('periodic:uji.lama', { every: 600_000 }, { name: 'uji.lama' });
      expect(await scheduler.start()).toBe('bullmq');
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers.map((s) => s.key).sort()).toEqual(['periodic:uji.berkala', 'periodic:uji.harian']);
      expect(schedulers.find((s) => s.key === 'periodic:uji.harian')).toMatchObject({
        pattern: '0 1 * * *',
        tz: 'Asia/Jakarta',
      });
      await queue.add('uji.berkala', {});
      const deadline = Date.now() + 15_000;
      while (ran === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      expect(ran).toBeGreaterThanOrEqual(1);
    } finally {
      await scheduler.onModuleDestroy();
      await queue.obliterate({ force: true });
      await queue.close();
      connection.disconnect();
    }
  });
});

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
