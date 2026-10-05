import { envSchemas, parseEnv } from '@simrs/shared';
import { type FieldKeys, loadFieldKeys } from '@simrs/shared/node';
import { z } from 'zod';

export const workerEnvSchema = envSchemas.base
  .extend(envSchemas.database.shape)
  .extend(envSchemas.redis.shape)
  .extend(envSchemas.integration.shape)
  // Operasi outbox yang membaca identitas pasien (verifikasi NIK ke Dukcapil) mendekripsi di worker.
  .extend(envSchemas.fieldCrypto.shape)
  .extend(envSchemas.keyRotation.shape)
  .extend({
    OUTBOX_POLL_MS: z.coerce.number().int().min(250).default(2000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    OUTBOX_HTTP_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),
    /** Alamat web untuk tautan di email/WhatsApp notifikasi (P09). */
    WEB_BASE_URL: z.url().default('http://localhost:3000'),
    /**
     * Penjadwal putaran outbox: `bullmq` (Redis, wajib di produksi), `interval` (timer di proses ini; satu worker,
     * hanya untuk pengembangan tanpa Docker), atau `auto` = BullMQ bila Redis terjangkau, selain itu interval
     * (di luar produksi).
     */
    OUTBOX_SCHEDULER: z.enum(['auto', 'bullmq', 'interval']).default('auto'),
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema> & {
  /** Cincin kunci enkripsi kolom + blind index (ADR-0015, pembaruan 5 Okt 2026). */
  fieldKeys: FieldKeys;
};

export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  const env = parseEnv(workerEnvSchema, source);
  if (env.APP_ENV === 'production' && env.OUTBOX_SCHEDULER === 'interval') {
    throw new Error('Konfigurasi env tidak valid → OUTBOX_SCHEDULER=interval tidak boleh di produksi');
  }
  return { ...env, fieldKeys: loadFieldKeys(env) };
}

export const WORKER_ENV = Symbol('WORKER_ENV');
