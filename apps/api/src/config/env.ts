import { devToolsAllowed, envSchemas, parseEnv } from '@simrs/shared';
import { z } from 'zod';

export const apiEnvSchema = envSchemas.base
  .extend(envSchemas.host.shape)
  .extend(envSchemas.database.shape)
  .extend(envSchemas.redis.shape)
  .extend(envSchemas.s3.shape)
  .extend(envSchemas.api.shape)
  .extend(envSchemas.integration.shape)
  .extend({
    /** Batas permintaan per IP per menit (semua endpoint kecuali health/ready). */
    RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(600),
  });

export type ApiEnv = z.infer<typeof apiEnvSchema> & { devTools: boolean };

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  const env = parseEnv(apiEnvSchema, source);
  return { ...env, devTools: devToolsAllowed(env) };
}

export const API_ENV = Symbol('API_ENV');
