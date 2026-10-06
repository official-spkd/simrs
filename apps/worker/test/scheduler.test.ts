/**
 * Penjadwal outbox tanpa Redis (pengembangan tanpa Docker): timer tanpa tumpang tindih; ditolak di produksi.
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { loadWorkerEnv, type WorkerEnv } from '../src/config/env';
import type { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { OutboxScheduler } from '../src/outbox/outbox.scheduler';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://127.0.0.1:1',
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  FIELD_HASH_KEY: Buffer.alloc(32, 2).toString('base64'),
};

describe('penjadwal outbox', () => {
  it('interval ditolak di produksi; auto adalah bawaan', () => {
    expect(() => loadWorkerEnv({ ...base, APP_ENV: 'production', OUTBOX_SCHEDULER: 'interval' })).toThrow(
      /OUTBOX_SCHEDULER=interval/,
    );
    expect(loadWorkerEnv({ ...base, APP_ENV: 'local' }).OUTBOX_SCHEDULER).toBe('auto');
  });

  it('produksi menolak INTEGRATION_MODE=mock (juga bawaan bila lupa disetel)', () => {
    const prod = {
      ...base,
      APP_ENV: 'production',
      AUDIT_ANCHOR_KEY: Buffer.alloc(32, 3).toString('base64'),
      AUDIT_ANCHOR_BUCKET: 'simrs-audit-anchor',
      S3_ENDPOINT: 'http://127.0.0.1:9000',
      S3_ACCESS_KEY: 'uji',
      S3_SECRET_KEY: 'uji-rahasia',
    };
    expect(() => loadWorkerEnv(prod)).toThrow(/INTEGRATION_MODE=mock/);
    expect(() => loadWorkerEnv({ ...prod, INTEGRATION_MODE: 'mock' })).toThrow(/INTEGRATION_MODE=mock/);
    expect(loadWorkerEnv({ ...prod, INTEGRATION_MODE: 'sandbox' }).INTEGRATION_MODE).toBe('sandbox');
    expect(loadWorkerEnv({ ...base, APP_ENV: 'staging' }).INTEGRATION_MODE).toBe('mock');
  });

  it('auto tanpa Redis (lokal) → timer; putaran tidak tumpang tindih; berhenti saat modul ditutup', async () => {
    const env: WorkerEnv = loadWorkerEnv({ ...base, APP_ENV: 'local', OUTBOX_POLL_MS: '250' });
    let running = 0;
    let maxConcurrent = 0;
    let calls = 0;
    const dispatcher = {
      dispatchOnce: async () => {
        running += 1;
        calls += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise((r) => setTimeout(r, 300));
        running -= 1;
        return { claimed: 0, sent: 0, failed: 0, dead: 0 };
      },
    } as unknown as OutboxDispatcher;
    const scheduler = new OutboxScheduler(env, dispatcher);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 1200));
    await scheduler.onModuleDestroy();
    const after = calls;
    await new Promise((r) => setTimeout(r, 600));
    expect(after).toBeGreaterThanOrEqual(2);
    expect(maxConcurrent).toBe(1);
    expect(calls).toBeLessThanOrEqual(after + 1);
  });
});
