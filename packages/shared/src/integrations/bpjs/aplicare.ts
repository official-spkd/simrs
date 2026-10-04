import { z } from 'zod';
import {
  type BpjsEndpoint,
  type BpjsRejectionCode,
  bpjsKodePpkSchema,
  classifyBpjsRejection,
} from './common';

/**
 * I03 → K05 · Aplicare: ketersediaan tempat tidur per kelas/ruang, diperbarui dari papan bed (fase 3, potongan
 * 3.3). Path relatif terhadap `BPJS_SERVICE_PREFIX.aplicare` (produksi `aplicaresws`). Header bertanda tangan sama
 * dengan VClaim, tetapi respons TIDAK terenkripsi dan sukses ditandai `metadata.code` = 1. Rangkuman; cocokkan
 * dengan katalog resmi (termasuk kode kelas) sebelum integrasi nyata.
 */
export const APLICARE_ENDPOINTS = {
  /** Referensi kelas rawat → `aplicareRefKelasResponseSchema`. */
  refKelas: { method: 'GET', path: '/rest/ref/kelas' },
  /** Daftar ruang terdaftar milik PPK, `start` mulai 1 → `aplicareBedListResponseSchema` + `metadata.totalitems`. */
  bedRead: { method: 'GET', path: '/rest/bed/read/:kodeppk/:start/:limit' },
  /** Daftarkan ruang baru → `metadata` saja. */
  bedCreate: { method: 'POST', path: '/rest/bed/create/:kodeppk' },
  /** Perbarui kapasitas/ketersediaan ruang terdaftar → `metadata` saja. */
  bedUpdate: { method: 'POST', path: '/rest/bed/update/:kodeppk' },
  /** Hapus ruang → `metadata` saja. */
  bedDelete: { method: 'POST', path: '/rest/bed/delete/:kodeppk' },
} as const satisfies Record<string, BpjsEndpoint>;

export const APLICARE_OK = 1;
/** Kode galat yang dipakai mock (pesan berawalan teks baku `BPJS_REJECTIONS`). */
export const APLICARE_ERROR_CODE = 0;

export const aplicareMetadataSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  totalitems: z.number().int().optional(),
});
export const aplicareEnvelopeSchema = z.object({
  metadata: aplicareMetadataSchema,
  response: z.unknown().optional(),
});
export type AplicareEnvelope = z.infer<typeof aplicareEnvelopeSchema>;

/**
 * Kelas rawat Aplicare yang dipakai mock, selaras kelas bangsal fixture (VIP, Kelas 1–3, ICU, HCU, Isolasi).
 * Konektor membaca daftar ini dari `refKelas`, jangan menyalin kodenya.
 */
export const APLICARE_KELAS = [
  { kodekelas: 'VIP', namakelas: 'VIP' },
  { kodekelas: 'KL1', namakelas: 'KELAS I' },
  { kodekelas: 'KL2', namakelas: 'KELAS II' },
  { kodekelas: 'KL3', namakelas: 'KELAS III' },
  { kodekelas: 'ICU', namakelas: 'ICU' },
  { kodekelas: 'HCU', namakelas: 'HCU' },
  { kodekelas: 'ISO', namakelas: 'ISOLASI' },
] as const;

export const aplicareRefKelasResponseSchema = z.object({
  list: z.array(z.object({ kodekelas: z.string(), namakelas: z.string() })),
});

/** Angka bed: Aplicare menerima angka atau string angka (`"20"`); dinormalkan ke angka. */
const jumlah = z.union([
  z.number().int().min(0),
  z
    .string()
    .regex(/^\d{1,5}$/)
    .transform(Number),
]);

export const aplicareBedRequestSchema = z
  .object({
    kodekelas: z.string().min(1).max(10),
    koderuang: z.string().min(1).max(20),
    namaruang: z.string().min(1).max(100),
    kapasitas: jumlah,
    tersedia: jumlah,
    tersediapria: jumlah,
    tersediawanita: jumlah,
    tersediapriawanita: jumlah,
  })
  .refine((b) => b.tersedia <= b.kapasitas, { message: 'tersedia melebihi kapasitas', path: ['tersedia'] })
  .refine((b) => b.tersediapria + b.tersediawanita + b.tersediapriawanita <= b.tersedia, {
    message: 'rincian tersedia per jenis kelamin melebihi tersedia',
    path: ['tersediapriawanita'],
  });
export type AplicareBedRequest = z.infer<typeof aplicareBedRequestSchema>;

export const aplicareBedDeleteRequestSchema = z.object({
  kodekelas: z.string().min(1).max(10),
  koderuang: z.string().min(1).max(20),
});
export type AplicareBedDeleteRequest = z.infer<typeof aplicareBedDeleteRequestSchema>;

export const aplicareBedSchema = z.object({
  kodeppk: bpjsKodePpkSchema,
  kodekelas: z.string(),
  namakelas: z.string(),
  koderuang: z.string(),
  namaruang: z.string(),
  kapasitas: z.number().int().min(0),
  tersedia: z.number().int().min(0),
  tersediapria: z.number().int().min(0),
  tersediawanita: z.number().int().min(0),
  tersediapriawanita: z.number().int().min(0),
  /** `YYYY-MM-DD HH:mm:ss` WIB. */
  lastupdate: z.string(),
  rownumber: z.number().int().min(1),
});
export type AplicareBed = z.infer<typeof aplicareBedSchema>;
export const aplicareBedListResponseSchema = z.object({ list: z.array(aplicareBedSchema) });

export type AplicareDecoded<T> =
  | { ok: true; data: T; totalitems?: number }
  | { ok: false; kind: 'rejected'; code: string; message: string; rejection: BpjsRejectionCode }
  | { ok: false; kind: 'invalid'; message: string };

/** Dekode respons Aplicare (polos, tanpa kripto); tanpa skema untuk operasi tulis. */
export function decodeAplicareResponse<T = undefined>(
  body: unknown,
  schema: z.ZodType<T> | null,
): AplicareDecoded<T> {
  const env = aplicareEnvelopeSchema.safeParse(body);
  if (!env.success) return { ok: false, kind: 'invalid', message: 'Amplop Aplicare tidak dikenali' };
  const { code, message, totalitems } = env.data.metadata;
  if (code !== APLICARE_OK) {
    return {
      ok: false,
      kind: 'rejected',
      code: String(code),
      message,
      rejection: classifyBpjsRejection(message),
    };
  }
  if (!schema) return { ok: true, data: undefined as T };
  const parsed = schema.safeParse(env.data.response);
  if (!parsed.success)
    return { ok: false, kind: 'invalid', message: 'Isi respons Aplicare tidak sesuai kontrak' };
  return { ok: true, data: parsed.data, ...(totalitems === undefined ? {} : { totalitems }) };
}
