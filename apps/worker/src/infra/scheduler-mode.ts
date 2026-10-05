import { Redis } from 'ioredis';
import type { WorkerEnv } from '../config/env';

export type SchedulerMode = 'bullmq' | 'interval';

/**
 * Penjadwal outbox dan job berkala (P11): `bullmq` bila diminta atau (mode `auto`) Redis terjangkau; di luar
 * produksi tanpa Redis jatuh ke timer di proses ini (satu worker saja, pengembangan tanpa Docker).
 */
export async function resolveSchedulerMode(
  env: Pick<WorkerEnv, 'OUTBOX_SCHEDULER' | 'APP_ENV' | 'REDIS_URL'>,
): Promise<SchedulerMode> {
  if (env.OUTBOX_SCHEDULER === 'interval') return 'interval';
  if (env.OUTBOX_SCHEDULER === 'bullmq' || env.APP_ENV === 'production') return 'bullmq';
  return (await redisReachable(env.REDIS_URL)) ? 'bullmq' : 'interval';
}

export async function redisReachable(url: string): Promise<boolean> {
  const probe = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 1000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  probe.on('error', () => {});
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

/** Koneksi BullMQ (Queue/Worker butuh `maxRetriesPerRequest: null`). */
export function bullConnection(env: Pick<WorkerEnv, 'REDIS_URL'>): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
