import { isIP } from 'node:net';
import { devToolsAllowed, envSchemas, parseEnv } from '@simrs/shared';
import { type FieldKeys, loadFieldKeys } from '@simrs/shared/node';
import { z } from 'zod';

const TRUST_PROXY_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

/**
 * Nilai `trust proxy` Express: jumlah hop (1–5) atau daftar alamat/CIDR/nama. `true`/`*` sengaja ditolak:
 * mempercayai semua pengirim membuat klien bisa memalsukan IP (dan lolos dari batas laju per IP).
 */
export function parseTrustProxy(raw: string): number | string[] | null {
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    return hops >= 1 && hops <= 5 ? hops : null;
  }
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const valid = (p: string) => {
    if (TRUST_PROXY_NAMES.has(p)) return true;
    const [addr = '', bits, ...rest] = p.split('/');
    const family = isIP(addr);
    if (rest.length > 0 || family === 0) return false;
    return bits === undefined || (/^\d+$/.test(bits) && Number(bits) <= (family === 4 ? 32 : 128));
  };
  return parts.length > 0 && parts.every(valid) ? parts : null;
}

export const apiEnvSchema = envSchemas.base
  .extend(envSchemas.host.shape)
  .extend(envSchemas.database.shape)
  .extend(envSchemas.redis.shape)
  .extend(envSchemas.s3.shape)
  .extend(envSchemas.storage.shape)
  .extend(envSchemas.api.shape)
  .extend(envSchemas.integration.shape)
  .extend(envSchemas.fieldCrypto.shape)
  .extend(envSchemas.rateLimit.shape)
  .extend({
    /** Umur token akses (menit) dan umur maksimum sesi/refresh (jam). */
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),
    /**
     * Umur cache matriks izin per tenant × peran (detik). Perubahan lewat layar Akses berlaku seketika
     * (invalidasi + siaran Redis); TTL membatasi keusangan bila siaran terlewat. 0 = cache mati.
     */
    AUTHZ_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(300).default(30),
    /**
     * Mode pengembangan tanpa login: tenant dari header X-Tenant-Id. Hanya berlaku bila APP_ENV=local
     * (bukan staging/production) DAN flag ini true. Dipakai tes lama dan alat pengembang.
     */
    ALLOW_DEV_TENANT_HEADER: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /**
     * Proxy tepercaya untuk `X-Forwarded-For`/`-Host` (web BFF, reverse proxy). Contoh: `loopback`,
     * `10.0.0.0/8,loopback`, atau jumlah hop `1`. Tanpa ini, semua permintaan lewat web tampak datang dari
     * satu IP (server web), sehingga batas laju login berlaku untuk seluruh RS sekaligus. Wajib di produksi.
     */
    TRUST_PROXY: z
      .string()
      .trim()
      .optional()
      .transform((v, ctx) => {
        if (!v) return undefined;
        const parsed = parseTrustProxy(v);
        if (parsed === null) {
          ctx.addIssue({
            code: 'custom',
            message:
              'Isi dengan jumlah hop (1–5) atau daftar alamat/CIDR/loopback/uniquelocal; true/* ditolak',
          });
          return z.NEVER;
        }
        return parsed;
      }),
  });

export type ApiEnv = z.infer<typeof apiEnvSchema> & {
  devTools: boolean;
  devTenantHeader: boolean;
  /** Cincin kunci enkripsi kolom + blind index (ADR-0015, pembaruan 5 Okt 2026). */
  fieldKeys: FieldKeys;
};

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  const env = parseEnv(apiEnvSchema, source);
  if (env.APP_ENV === 'production' && env.TRUST_PROXY === undefined) {
    throw new Error(
      'Konfigurasi env tidak valid → TRUST_PROXY wajib di produksi (alamat web/reverse proxy di depan API)',
    );
  }
  if (env.APP_ENV === 'production' && env.RATE_LIMIT_STORE === 'memory') {
    throw new Error(
      'Konfigurasi env tidak valid → RATE_LIMIT_STORE=memory tidak boleh di produksi (penghitung harus sama di semua instans)',
    );
  }
  // Disk hanya untuk mesin pengembang dan tes; staging dan produksi menyimpan berkas di S3/MinIO (ADR-0020).
  if (env.STORAGE_DRIVER === 'disk' && env.APP_ENV !== 'local') {
    throw new Error(
      'Konfigurasi env tidak valid → STORAGE_DRIVER=disk hanya untuk APP_ENV=local; staging dan produksi memakai s3',
    );
  }
  const fieldKeys = loadFieldKeys(env);
  const devTools = devToolsAllowed(env);
  return {
    ...env,
    fieldKeys,
    devTools,
    devTenantHeader: devTools && env.APP_ENV === 'local' && env.ALLOW_DEV_TENANT_HEADER,
  };
}

export const API_ENV = Symbol('API_ENV');
