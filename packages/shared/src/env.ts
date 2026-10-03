import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);

/** Potongan skema env; tiap aplikasi menggabungkan yang ia butuhkan. */
export const envSchemas = {
  base: z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    TZ: z.string().default('Asia/Jakarta'),
  }),
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
  integration: z.object({
    INTEGRATION_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    MOCK_BASE_URL: z.url().default('http://localhost:4100'),
  }),
} as const;

/** Validasi env sekali saat start; gagal cepat dengan daftar variabel yang salah (tanpa mencetak nilainya). */
export function parseEnv<T extends z.ZodType>(schema: T, source: Record<string, string | undefined>): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Konfigurasi env tidak valid → ${fields}`);
  }
  return result.data;
}
