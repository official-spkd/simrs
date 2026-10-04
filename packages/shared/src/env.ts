import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);

/**
 * Kunci 32 byte dalam base64 (`openssl rand -base64 32` → 44 karakter berakhiran `=`). Padding dan alfabet
 * url-safe diterima, sama dengan dekoder base64 Node yang memakainya.
 */
const base64Key32 = z
  .string()
  .regex(/^[A-Za-z0-9+/_-]{43}=?$/, 'Harus 32 byte base64 (openssl rand -base64 32)');

export const APP_ENVS = ['local', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/**
 * Fitur khusus pengembangan (Swagger, endpoint `/dev`, tenant dari header, panduan superadmin tanpa login)
 * hanya aktif bila APP_ENV eksplisit `local`/`staging` DAN NODE_ENV bukan `production`.
 * APP_ENV yang tidak disetel dianggap `production` (gagal aman).
 */
export function devToolsAllowed(env: { APP_ENV?: string; NODE_ENV?: string }): boolean {
  return resolveAppEnv(env.APP_ENV) !== 'production' && env.NODE_ENV !== 'production';
}

/** APP_ENV gagal aman: tidak disetel, kosong, atau tak dikenal → `production`. */
export function resolveAppEnv(value: string | undefined): AppEnv {
  return (APP_ENVS as readonly string[]).includes(value ?? '') ? (value as AppEnv) : 'production';
}

/** Potongan skema env; tiap aplikasi menggabungkan yang ia butuhkan. */
export const envSchemas = {
  base: z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Kosong (`APP_ENV=`) diperlakukan sama dengan tidak disetel → production.
    APP_ENV: z.preprocess((v) => (v === '' ? undefined : v), z.enum(APP_ENVS).default('production')),
    TZ: z.string().default('Asia/Jakarta'),
  }),
  /** Alamat bind server. Default hanya loopback agar layanan lokal tidak terbuka ke jaringan. */
  host: z.object({ HOST: z.string().default('127.0.0.1') }),
  database: z.object({ DATABASE_URL: z.url() }),
  migrator: z.object({ MIGRATOR_DATABASE_URL: z.url() }),
  redis: z.object({ REDIS_URL: z.url() }),
  s3: z.object({
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().default('ap-southeast-3'),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_BUCKET_DOCUMENTS: z.string().default('simrs-documents'),
  }),
  api: z.object({ API_PORT: port.default(4000), WEB_BASE_URL: z.url().default('http://localhost:3000') }),
  mock: z.object({
    MOCK_PORT: port.default(4100),
    TPDI_WEBHOOK_SECRET: z.string().min(1),
    TPDI_WEBHOOK_TARGET: z.url(),
    BPJS_CONS_ID: z.string().min(1),
    BPJS_SECRET_KEY: z.string().min(1),
  }),
  /** Enkripsi kolom (rahasia MFA, identitas pasien) dan kunci blind index; API dan worker memakai kunci sama. */
  fieldCrypto: z.object({ FIELD_ENCRYPTION_KEY: base64Key32, FIELD_HASH_KEY: base64Key32 }),
  integration: z.object({
    INTEGRATION_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    MOCK_BASE_URL: z.url().default('http://localhost:4100'),
  }),
} as const;

/** Validasi env sekali saat start; gagal cepat dengan daftar variabel yang salah (tanpa mencetak nilainya). */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Konfigurasi env tidak valid → ${fields}`);
  }
  return result.data;
}
