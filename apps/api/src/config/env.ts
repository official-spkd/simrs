import { devToolsAllowed, envSchemas, parseEnv } from '@simrs/shared';
import { z } from 'zod';

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'Harus 32 byte base64 (openssl rand -base64 32)');

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
    /** Batas endpoint kredensial (login, MFA, ganti sandi, refresh) per IP per menit. */
    AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),
    /** Kunci enkripsi kolom (rahasia MFA, NIK, …) dan kunci blind index. */
    FIELD_ENCRYPTION_KEY: base64Key32,
    FIELD_HASH_KEY: base64Key32,
    /** Umur token akses (menit) dan umur maksimum sesi/refresh (jam). */
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),
    /**
     * Mode pengembangan tanpa login: tenant dari header X-Tenant-Id. Hanya berlaku bila APP_ENV=local
     * (bukan staging/production) DAN flag ini true. Dipakai tes lama dan alat pengembang.
     */
    ALLOW_DEV_TENANT_HEADER: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  });

export type ApiEnv = z.infer<typeof apiEnvSchema> & { devTools: boolean; devTenantHeader: boolean };

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  const env = parseEnv(apiEnvSchema, source);
  const devTools = devToolsAllowed(env);
  return {
    ...env,
    devTools,
    devTenantHeader: devTools && env.APP_ENV === 'local' && env.ALLOW_DEV_TENANT_HEADER,
  };
}

export const API_ENV = Symbol('API_ENV');
