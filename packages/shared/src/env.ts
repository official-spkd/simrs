import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

/**
 * Kunci 32 byte dalam base64 (`openssl rand -base64 32` → 44 karakter berakhiran `=`). Padding dan alfabet
 * url-safe diterima, sama dengan dekoder base64 Node yang memakainya.
 */
const base64Key32 = z
  .string()
  .regex(/^[A-Za-z0-9+/_-]{43}=?$/, 'Harus 32 byte base64 (openssl rand -base64 32)');

/** Cincin kunci `<ID>:<base64 32 byte>` dipisah koma (mis. `v2:…,v1:…`); isi rinci diperiksa saat start. */
const keyRingSpec = z
  .string()
  .trim()
  .regex(
    /^v[1-9][0-9]{0,2}:[A-Za-z0-9+/_-]{43}=?(?:\s*,\s*v[1-9][0-9]{0,2}:[A-Za-z0-9+/_-]{43}=?)*$/,
    'Format <ID>:<base64 32 byte>, dipisah koma (mis. v2:…,v1:…)',
  );

/** Kosong (`X=`) diperlakukan sama dengan tidak disetel. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

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
    S3_BUCKET_DOCUMENTS: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'Nama bucket S3 tidak valid')
      .default('simrs-documents'),
  }),
  /**
   * Penyimpanan berkas dokumen (P08, ADR-0020): `s3` = MinIO/S3 (`S3_*`, wajib di staging dan produksi), `disk` =
   * folder lokal (hanya APP_ENV=local). Path relatif dihitung dari folder kerja aplikasi (`apps/<app>`).
   */
  storage: z.object({
    STORAGE_DRIVER: z.enum(['disk', 's3']).default('disk'),
    STORAGE_DISK_ROOT: z.string().trim().min(1).default('../../.local/storage'),
  }),
  api: z.object({ API_PORT: port.default(4000), WEB_BASE_URL: z.url().default('http://localhost:3000') }),
  /**
   * Batas laju API (P02). Hitungan per menit per endpoint: per IP klien (`TRUST_PROXY` menentukan IP asli),
   * khusus endpoint kredensial per IP, dan per pengguna untuk permintaan yang sudah login (staf RS sering berbagi
   * satu IP lewat NAT). Penghitung disimpan di Redis agar sama di semua instans API.
   */
  rateLimit: z.object({
    /** Per IP per endpoint (semua endpoint kecuali health/ready). */
    RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(600),
    /** Endpoint kredensial (`@AuthRateLimited`: login, MFA, ganti sandi, refresh) per IP per endpoint. */
    AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),
    /** Per pengguna login per endpoint, apa pun IP-nya. */
    USER_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(300),
    /**
     * Gateway informasi publik (F08, `@PublicRateLimited`: jadwal, antrean berjalan) per IP per endpoint, di samping batas
     * umum. Cek status booking memakai batas endpoint kredensial (`AUTH_RATE_LIMIT_PER_MIN`) karena berupa tebakan
     * kode + tanggal lahir.
     */
    PUBLIC_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(60),
    /**
     * Penyimpanan penghitung. `auto` = Redis bila terjangkau saat start, selain itu memori dengan peringatan; di
     * produksi `auto` sama dengan `redis`. `redis` = Redis wajib: bila gagal, endpoint kredensial ditolak 503 (gagal
     * tertutup) dan batas lain sementara per instans. `memory` = per proses, ditolak di produksi.
     */
    RATE_LIMIT_STORE: z.enum(['auto', 'redis', 'memory']).default('auto'),
    /**
     * Awalan kunci Redis. Bawaan `simrs:rl:<nama database>:` sehingga semua instans satu deployment berbagi
     * penghitung, sedangkan server pengembangan, E2E, dan worktree lain yang memakai Redis yang sama tidak.
     */
    RATE_LIMIT_REDIS_PREFIX: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9:_.-]{1,100}$/, 'Huruf, angka, : _ . - (maks. 100)')
        .optional(),
    ),
  }),
  mock: z.object({
    MOCK_PORT: port.default(4100),
    TPDI_WEBHOOK_SECRET: z.string().min(1),
    TPDI_WEBHOOK_TARGET: z.url(),
    BPJS_CONS_ID: z.string().min(1),
    BPJS_SECRET_KEY: z.string().min(1),
  }),
  /**
   * Enkripsi kolom (rahasia MFA, identitas pasien) dan kunci blind index; API, worker, dan CLI rotasi memakai kunci
   * sama. Cincin `FIELD_*_KEYS` (`v2:<base64>,v1:<base64>`, kunci pertama = aktif) atau satu kunci format lama
   * `FIELD_*_KEY` (= `v1`). Kombinasi dan isi kunci divalidasi `fieldKeysFromEnv` (`@simrs/shared/node`) saat start.
   */
  fieldCrypto: z.object({
    FIELD_ENCRYPTION_KEY: optional(base64Key32),
    FIELD_ENCRYPTION_KEYS: optional(keyRingSpec),
    FIELD_HASH_KEY: optional(base64Key32),
    FIELD_HASH_KEYS: optional(keyRingSpec),
  }),
  /**
   * Job enkripsi ulang kolom (rotasi kunci, ADR-0015 pembaruan 5 Okt 2026). `auto` = worker menjalankan putaran
   * berkala selama cincin masih memuat lebih dari satu kunci; `off` = hanya lewat `pnpm db:rotate-keys --run`.
   * Batch kecil + jeda menjaga beban database tetap rendah (transaksi pendek per batch).
   */
  keyRotation: z.object({
    FIELD_KEY_ROTATION: z.enum(['off', 'auto']).default('off'),
    FIELD_KEY_ROTATION_BATCH: z.coerce.number().int().min(1).max(2000).default(200),
    FIELD_KEY_ROTATION_PAUSE_MS: z.coerce.number().int().min(0).max(60_000).default(100),
    FIELD_KEY_ROTATION_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  }),
  integration: z.object({
    INTEGRATION_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    MOCK_BASE_URL: z.url().default('http://localhost:4100'),
  }),
  /**
   * Kunci HMAC jangkar hash audit (P04, ADR-0072): terpisah dari kunci kolom, dipakai worker (menandatangani) dan API
   * (memeriksa). Wajib di produksi; kosong di lokal = jangkar tidak ditulis dan `/audit/verify` memeriksa penuh.
   */
  auditAnchorKey: z.object({
    AUDIT_ANCHOR_KEY: z.preprocess(emptyToUndefined, base64Key32.optional()),
  }),
  /**
   * Bucket WORM jangkar audit (S3 Object Lock, mode COMPLIANCE) + masa kunci objek. Bucket harus dibuat dengan
   * object lock aktif (`mc mb --with-lock`). Kosong di lokal = jangkar hanya di database.
   */
  auditAnchorStore: z.object({
    AUDIT_ANCHOR_BUCKET: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z
        .string()
        .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'Nama bucket S3 tidak valid')
        .optional(),
    ),
    AUDIT_ANCHOR_RETENTION_DAYS: z.coerce.number().int().min(1).max(36_500).default(3650),
  }),
  /**
   * Klien BPJS (worker dan API): satu set kredensial (keputusan fase 2 #11). Kosong di luar produksi = nilai mock
   * (`bpjsClientConfig` di `@simrs/shared/node`); di produksi wajib diisi.
   */
  bpjs: z.object({
    BPJS_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    BPJS_CONS_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    BPJS_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    BPJS_USER_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  }),
} as const;

/**
 * Kunci jangkar audit wajib di produksi dan tidak boleh sama dengan kunci kolom (kunci terpisah = bocornya satu
 * kunci tidak sekaligus memungkinkan memalsukan jangkar). Dipanggil `loadApiEnv`/`loadWorkerEnv` setelah parse.
 */
export function auditAnchorKeyProblem(env: {
  APP_ENV: AppEnv;
  AUDIT_ANCHOR_KEY?: string;
  FIELD_ENCRYPTION_KEY?: string;
  FIELD_HASH_KEY?: string;
  /** Cincin kunci kolom (`v2:<b64>,v1:<b64>`, ADR-0015): setiap kunci di cincin juga tidak boleh dipakai ulang. */
  FIELD_ENCRYPTION_KEYS?: string;
  FIELD_HASH_KEYS?: string;
}): string | null {
  if (!env.AUDIT_ANCHOR_KEY) {
    return env.APP_ENV === 'production' ? 'AUDIT_ANCHOR_KEY wajib di produksi' : null;
  }
  // Bandingkan bentuk base64 baku (tanpa padding, alfabet standar); modul ini juga dimuat di browser (tanpa Buffer).
  const norm = (b64: string) => b64.trim().replace(/=+$/, '').replaceAll('-', '+').replaceAll('_', '/');
  const ringKeys = (spec?: string) =>
    (spec ?? '')
      .split(',')
      .map((entry) => entry.slice(entry.indexOf(':') + 1))
      .filter((k) => k.trim() !== '');
  const key = norm(env.AUDIT_ANCHOR_KEY);
  const others = [
    env.FIELD_ENCRYPTION_KEY,
    env.FIELD_HASH_KEY,
    ...ringKeys(env.FIELD_ENCRYPTION_KEYS),
    ...ringKeys(env.FIELD_HASH_KEYS),
  ].filter((k): k is string => !!k);
  const same = others.some((other) => norm(other) === key);
  return same
    ? 'AUDIT_ANCHOR_KEY harus berbeda dari semua kunci kolom (FIELD_ENCRYPTION_KEY[S] dan FIELD_HASH_KEY[S])'
    : null;
}

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
