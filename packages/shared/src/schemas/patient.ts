import { z } from 'zod';
import { isoDateJakarta } from '../datetime';
import {
  IDENTIFIER_SYSTEM_CODES,
  IDENTIFIER_SYSTEMS,
  MERGE_ATTRIBUTES,
  PRIVACY_CONSENT_KINDS,
  type IdentifierSystem,
  isValidIdentifier,
  normalizeIdentifier,
  normalizePhone,
  PATIENT_SEXES,
} from '../patient';

/** P05 · Skema validasi data pasien (dipakai API dan web). Batasan yang sama ada sebagai CHECK di database. */
const NAME = z.string().trim().min(2, 'Nama minimal 2 karakter').max(120, 'Nama maksimal 120 karakter');

/** Tanggal lahir `YYYY-MM-DD`: tidak sebelum 1900 dan tidak melewati hari ini (WIB). */
export const BIRTH_DATE = z.iso
  .date('Gunakan format tanggal YYYY-MM-DD')
  .refine((v) => v >= '1900-01-01', 'Tanggal lahir tidak boleh sebelum 1900')
  .refine((v) => v <= isoDateJakarta(), 'Tanggal lahir tidak boleh di masa depan');

/** Nilai identifier dinormalisasi lalu divalidasi per sistem (NIK 16 digit, BPJS 13 digit, …). */
export function identifierValue(system: IdentifierSystem) {
  return z
    .string()
    .transform(normalizeIdentifier)
    .refine((v) => isValidIdentifier(system, v), IDENTIFIER_SYSTEMS[system].hint);
}

const PHONE = z.string().transform((v, ctx) => {
  const n = normalizePhone(v);
  if (!n) {
    ctx.addIssue({ code: 'custom', message: 'No. HP tidak valid (contoh 0812-3456-7890)' });
    return z.NEVER;
  }
  return n;
});

const ADDRESS = z.string().trim().min(5, 'Alamat minimal 5 karakter').max(300);

export const patientIdentifiersInputSchema = z.strictObject({
  nik: identifierValue('nik').optional(),
  bpjs: identifierValue('bpjs').optional(),
  ihs: identifierValue('ihs').optional(),
  paspor: identifierValue('paspor').optional(),
});

/**
 * Pasien baru. Tanggal lahir wajib kecuali pasien tanpa identitas (mis. IGD tidak sadar); untuk mereka
 * tanggal lahir boleh perkiraan (`birthDateEstimated`).
 */
export const createPatientSchema = z
  .strictObject({
    name: NAME,
    sex: z.enum(PATIENT_SEXES),
    birthDate: BIRTH_DATE.optional(),
    birthDateEstimated: z.boolean().default(false),
    motherName: NAME.optional(),
    address: ADDRESS.optional(),
    phone: PHONE.optional(),
    unidentified: z.boolean().default(false),
    identifiers: patientIdentifiersInputSchema.default({}),
  })
  .refine((v) => v.unidentified || v.birthDate !== undefined, {
    message: 'Tanggal lahir wajib diisi (kecuali pasien tanpa identitas)',
    path: ['birthDate'],
  });

export const updatePatientSchema = z
  .strictObject({
    name: NAME.optional(),
    sex: z.enum(PATIENT_SEXES).optional(),
    birthDate: BIRTH_DATE.nullable().optional(),
    birthDateEstimated: z.boolean().optional(),
    motherName: NAME.nullable().optional(),
    address: ADDRESS.nullable().optional(),
    phone: PHONE.nullable().optional(),
    unidentified: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Minimal satu field diubah');

/** Ganti/isi identifier. Mengganti nilai yang sudah ada wajib beralasan (nilai lama disimpan nonaktif). */
export const setIdentifierSchema = z.strictObject({
  value: z.string().min(1).max(40),
  reason: z.string().trim().min(10, 'Alasan minimal 10 karakter').max(300).optional(),
});

export const identifierSystemParam = z.enum(IDENTIFIER_SYSTEM_CODES);

/** Field identitas yang bisa dibuka utuh (izin `patient.identity`, diaudit). */
export const REVEALABLE_FIELDS = [...IDENTIFIER_SYSTEM_CODES, 'phone'] as const;
export type RevealableField = (typeof REVEALABLE_FIELDS)[number];
export const revealQuerySchema = z.strictObject({ field: z.enum(REVEALABLE_FIELDS) });

/** Pencarian: satu kotak (RM, NIK, BPJS, IHS, atau nama) + saringan tanggal lahir opsional. Tanpa kursor. */
export const patientSearchSchema = z.strictObject({
  q: z.string().trim().min(2, 'Ketik minimal 2 karakter').max(100),
  birthDate: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Keputusan MPI wajib beralasan (dasar verifikasi: KTP, wawancara, konfirmasi keluarga). */
const DECISION_REASON = z
  .string()
  .trim()
  .min(10, 'Alasan minimal 10 karakter: sebutkan dasar verifikasi (mis. KTP, wawancara)')
  .max(500);

export const mergeCandidateSchema = z.strictObject({
  reason: DECISION_REASON,
  /** Atribut yang diambil dari rekam medis B; selebihnya tetap milik A. */
  takeFromB: z.array(z.enum(MERGE_ATTRIBUTES)).max(MERGE_ATTRIBUTES.length).default([]),
});
export const mpiDecisionSchema = z.strictObject({ reason: DECISION_REASON });
/** `all` = terbuka + diputuskan 30 hari terakhir (masih bisa dibatalkan). */
export const matchListSchema = z.strictObject({
  status: z.enum(['open', 'decided', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Persetujuan privasi; pembukaan data wajib menyebut penerimanya. */
export const createConsentSchema = z
  .strictObject({
    kind: z.enum(PRIVACY_CONSENT_KINDS),
    recipient: z.string().trim().min(2).max(120).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.kind !== 'pembukaan_data' || v.recipient !== undefined, {
    message: 'Sebutkan penerima data (mis. nama asuransi)',
    path: ['recipient'],
  });
export const revokeConsentSchema = z.strictObject({
  reason: z.string().trim().min(10, 'Alasan minimal 10 karakter').max(300),
});

export type CreatePatientInput = z.infer<typeof createPatientSchema>;
export type CreateConsentInput = z.infer<typeof createConsentSchema>;
export type RevokeConsentInput = z.infer<typeof revokeConsentSchema>;
export type MergeCandidateInput = z.infer<typeof mergeCandidateSchema>;
export type MpiDecisionInput = z.infer<typeof mpiDecisionSchema>;
export type MatchListQuery = z.infer<typeof matchListSchema>;
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;
export type SetIdentifierInput = z.infer<typeof setIdentifierSchema>;
export type PatientSearchQuery = z.infer<typeof patientSearchSchema>;
