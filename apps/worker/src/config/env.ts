import { envSchemas, parseEnv } from '@simrs/shared';
import { z } from 'zod';

export const workerEnvSchema = envSchemas.base
  .extend(envSchemas.database.shape)
  .extend(envSchemas.redis.shape)
  .extend(envSchemas.integration.shape)
  .extend({
    OUTBOX_POLL_MS: z.coerce.number().int().min(250).default(2000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    OUTBOX_HTTP_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return parseEnv(workerEnvSchema, source);
}

export const WORKER_ENV = Symbol('WORKER_ENV');
