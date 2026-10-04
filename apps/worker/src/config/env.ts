import { auditAnchorKeyProblem, envSchemas, parseEnv } from '@simrs/shared';
import { z } from 'zod';

export const workerEnvSchema = envSchemas.base
  .extend(envSchemas.database.shape)
  .extend(envSchemas.redis.shape)
  .extend(envSchemas.integration.shape)
  // Operasi outbox yang membaca identitas pasien (verifikasi NIK ke Dukcapil) mendekripsi di worker.
  .extend(envSchemas.fieldCrypto.shape)
  // Jangkar hash audit (ADR-0072): kunci HMAC + bucket WORM. Kredensial S3 hanya wajib bila bucket diisi.
  .extend(envSchemas.auditAnchorKey.shape)
  .extend(envSchemas.auditAnchorStore.shape)
  .extend({
    S3_ENDPOINT: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
    S3_REGION: z.string().default('ap-southeast-3'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
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

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  const env = parseEnv(workerEnvSchema, source);
  if (env.APP_ENV === 'production' && env.OUTBOX_SCHEDULER === 'interval') {
    throw new Error('Konfigurasi env tidak valid → OUTBOX_SCHEDULER=interval tidak boleh di produksi');
  }
  const problem =
    auditAnchorKeyProblem(env) ??
    (env.APP_ENV === 'production' && !env.AUDIT_ANCHOR_BUCKET
      ? 'AUDIT_ANCHOR_BUCKET wajib di produksi (bucket WORM jangkar audit)'
      : null) ??
    (env.AUDIT_ANCHOR_BUCKET && !(env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY)
      ? 'AUDIT_ANCHOR_BUCKET butuh S3_ENDPOINT, S3_ACCESS_KEY, dan S3_SECRET_KEY'
      : null);
  if (problem) throw new Error(`Konfigurasi env tidak valid → ${problem}`);
  return env;
}

export const WORKER_ENV = Symbol('WORKER_ENV');
