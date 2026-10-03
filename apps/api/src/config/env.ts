import { envSchemas, parseEnv } from '@simrs/shared';

export const apiEnvSchema = envSchemas.base
  .extend(envSchemas.database.shape)
  .extend(envSchemas.redis.shape)
  .extend(envSchemas.s3.shape)
  .extend(envSchemas.api.shape)
  .extend(envSchemas.integration.shape);

export type ApiEnv = ReturnType<typeof loadApiEnv>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env) {
  return parseEnv(apiEnvSchema, source);
}

export const API_ENV = Symbol('API_ENV');
