import { z } from 'zod';

/**
 * P05 → I05 · Verifikasi data kependudukan (pola layanan verifikasi Dukcapil untuk instansi): RS mengirim NIK
 * + data yang hendak dicocokkan, Dukcapil menjawab hasil per elemen tanpa mengembalikan data pribadi.
 * Lokal: `apps/mock` (`POST /dukcapil/verify-data`). Dipakai worker (operasi outbox) dan mock.
 */
export const DUKCAPIL_VERIFY_OPERATION = 'dukcapil.nik.verify';

export const dukcapilVerifyRequestSchema = z.strictObject({
  nik: z.string().regex(/^\d{16}$/),
  nama: z.string().min(1).max(120).optional(),
  /** `YYYY-MM-DD`. */
  tanggalLahir: z.iso.date().optional(),
  /** L | P (kode Dukcapil). */
  jenisKelamin: z.enum(['L', 'P']).optional(),
});
export type DukcapilVerifyRequest = z.infer<typeof dukcapilVerifyRequestSchema>;

/** `null` = elemen tidak dikirim/tidak bisa dicocokkan. */
export const dukcapilVerifyResponseSchema = z.object({
  found: z.boolean(),
  match: z
    .object({
      nama: z.boolean().nullable(),
      tanggalLahir: z.boolean().nullable(),
      jenisKelamin: z.boolean().nullable(),
    })
    .optional(),
});
export type DukcapilVerifyResponse = z.infer<typeof dukcapilVerifyResponseSchema>;

/**
 * Tanggal lahir dan jenis kelamin yang terkandung di NIK (digit 7–12: DDMMYY, tanggal perempuan + 40).
 * Tahun hanya dua digit (abad tidak tercantum). Null bila digit tanggal tidak masuk akal.
 */
export function nikBirthInfo(
  nik: string,
): { day: number; month: number; yearSuffix: number; sex: 'L' | 'P' } | null {
  if (!/^\d{16}$/.test(nik)) return null;
  const dd = Number(nik.slice(6, 8));
  const month = Number(nik.slice(8, 10));
  const yearSuffix = Number(nik.slice(10, 12));
  const female = dd > 40;
  const day = female ? dd - 40 : dd;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return { day, month, yearSuffix, sex: female ? 'P' : 'L' };
}
