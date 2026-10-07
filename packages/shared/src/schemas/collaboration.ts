import { z } from 'zod';
import {
  clinicalAuthorSchema,
  clinicalEntryMetaSchema,
  clinicalRevisionSchema,
  SAFETY_REASON_MIN,
} from './klinis';

/**
 * K10 · K15 · Konsultasi/rawat bersama/alih rawat, tim perawatan, paket formulir per setting + kelengkapan asesmen
 * (fase 3 potongan 3.8, EP 6b/7a, ADR-0059).
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().trim().max(max);

// ---------------------------------------------------------------------------------------------------------------
// K10 · Konsultasi
// ---------------------------------------------------------------------------------------------------------------

/** Jenis permintaan: konsul sekali, rawat bersama, alih rawat (DPJP utama berganti). */
export const CONSULT_KINDS = ['konsultasi', 'rawat_bersama', 'alih_rawat'] as const;
export type ConsultKind = (typeof CONSULT_KINDS)[number];
/** `segera` = cito (dijawab ≤ 1 jam), `biasa` ≤ 24 jam. */
export const CONSULT_URGENCIES = ['biasa', 'segera'] as const;
export type ConsultUrgency = (typeof CONSULT_URGENCIES)[number];
export const CONSULT_ANSWER_HOURS: Readonly<Record<ConsultUrgency, number>> = { segera: 1, biasa: 24 };

/**
 * Akses rekam konsultan berbatas waktu (jam): sejak permintaan sampai dijawab, lalu sejak jawaban untuk konsul
 * sekali. Rawat bersama/alih rawat yang diterima memakai relasi tim perawatan (berlaku selama dirawat).
 */
export const CONSULT_ACCESS_HOURS = 24;
/** Pertanyaan klinis minimal (karakter). */
export const CONSULT_QUESTION_MIN = 20;

/** `POST /api/v1/consults/requests` (berversi lewat `revision`). Tujuan: dokter tertentu dan/atau unit. */
export const consultRequestInputSchema = z
  .strictObject({
    encounterId: uuid,
    occurredAt: instant,
    kind: z.enum(CONSULT_KINDS),
    urgency: z.enum(CONSULT_URGENCIES),
    toUserId: uuid.nullable(),
    toUnitId: uuid.nullable(),
    question: text(2000).min(
      CONSULT_QUESTION_MIN,
      'Tulis pertanyaan klinis yang jelas (minimal 20 karakter).',
    ),
    revision: clinicalRevisionSchema,
  })
  .refine((v) => v.toUserId !== null || v.toUnitId !== null, {
    path: ['toUserId'],
    message: 'Pilih dokter atau unit tujuan konsultasi.',
  });
export type ConsultRequestInput = z.infer<typeof consultRequestInputSchema>;

/**
 * `POST /api/v1/consults/requests/:id/responses` (hanya dokter tujuan / dokter unit tujuan). `accept` = konsultan
 * menerima rawat bersama / alih rawat (tim perawatan ikut berubah); diabaikan untuk konsul sekali.
 */
export const consultResponseInputSchema = z.strictObject({
  occurredAt: instant,
  findings: text(2000),
  assessment: text(2000).min(1, 'Isi kesimpulan/diagnosis konsultan.'),
  recommendation: text(2000).min(1, 'Isi rekomendasi tata laksana.'),
  accept: z.boolean(),
  revision: clinicalRevisionSchema,
});
export type ConsultResponseInput = z.infer<typeof consultResponseInputSchema>;

/** Tindak lanjut jawaban (bentuk layar demo): konsul selesai, rawat bersama, atau alih rawat diterima. */
export const CONSULT_FOLLOW_UPS = ['selesai', 'rawat_bersama', 'alih_rawat'] as const;

export const consultResponseRecordSchema = clinicalEntryMetaSchema.extend({
  requestId: uuid,
  findings: z.string(),
  assessment: z.string(),
  recommendation: z.string(),
  accept: z.boolean(),
  followUp: z.enum(CONSULT_FOLLOW_UPS),
});
export type ConsultResponseRecord = z.infer<typeof consultResponseRecordSchema>;

export const consultRequestRecordSchema = clinicalEntryMetaSchema.extend({
  patientId: uuid,
  encounterId: uuid,
  kind: z.enum(CONSULT_KINDS),
  urgency: z.enum(CONSULT_URGENCIES),
  toUser: clinicalAuthorSchema.omit({ peran: true }).nullable(),
  toUnit: z.strictObject({ id: uuid, name: z.string() }).nullable(),
  question: z.string(),
  /** Batas jawab menurut urgensi. */
  dueAt: instant,
  /** `menunggu` sampai ada jawaban final. */
  state: z.enum(['menunggu', 'dijawab']),
  responses: z.array(consultResponseRecordSchema),
});
export type ConsultRequestRecord = z.infer<typeof consultRequestRecordSchema>;

/** Kotak masuk konsultasi: permintaan terbuka untuk saya atau unit penugasan saya. */
export const consultInboxItemSchema = z.strictObject({
  requestId: uuid,
  encounterId: uuid,
  patientId: uuid,
  patientName: z.string(),
  mrn: z.string(),
  kind: z.enum(CONSULT_KINDS),
  urgency: z.enum(CONSULT_URGENCIES),
  from: clinicalAuthorSchema,
  toUnit: z.strictObject({ id: uuid, name: z.string() }).nullable(),
  at: instant,
  dueAt: instant,
});
export type ConsultInboxItem = z.infer<typeof consultInboxItemSchema>;

/** `GET /api/v1/consults/consultants`: dokter aktif yang bisa dituju konsul (selain pelaku), dengan unit penugasan. */
export const consultantOptionSchema = z.strictObject({
  userId: uuid,
  nama: z.string(),
  units: z.array(z.string()),
});
export type ConsultantOption = z.infer<typeof consultantOptionSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Tim perawatan
// ---------------------------------------------------------------------------------------------------------------

export const CARE_TEAM_ROLE_CODES = ['dpjp_utama', 'rawat_bersama', 'konsultan', 'perawat_pj'] as const;
export type CareTeamRoleCode = (typeof CARE_TEAM_ROLE_CODES)[number];

export const careTeamMemberSchema = z.strictObject({
  id: uuid,
  user: z.strictObject({ userId: uuid, nama: z.string() }),
  role: z.enum(CARE_TEAM_ROLE_CODES),
  startedAt: instant,
  endedAt: instant.nullable(),
  endReason: z.string().nullable(),
});
export type CareTeamMember = z.infer<typeof careTeamMemberSchema>;

/**
 * `POST /api/v1/encounters/:id/care-team/primary` (`clinical.write`, hanya DPJP utama aktif): serah DPJP utama ke
 * dokter lain = keanggotaan lama diakhiri + keanggotaan baru (versi baru tim; relasi akses ikut).
 */
export const primaryDpjpChangeInputSchema = z.strictObject({
  userId: uuid,
  reason: z.string().trim().min(SAFETY_REASON_MIN).max(500),
});
export type PrimaryDpjpChangeInput = z.infer<typeof primaryDpjpChangeInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// K15 · Paket formulir per setting + kelengkapan (EP 6b/7a)
// ---------------------------------------------------------------------------------------------------------------

export const CARE_SETTINGS = ['rawat_jalan', 'igd', 'rawat_inap'] as const;
export type CareSetting = (typeof CARE_SETTINGS)[number];
/** Kelas kunjungan → setting paket formulir. */
export const CARE_SETTING_OF_CLASS: Readonly<Record<'AMB' | 'EMER' | 'IMP', CareSetting>> = {
  AMB: 'rawat_jalan',
  EMER: 'igd',
  IMP: 'rawat_inap',
};

export const carePackagesQuerySchema = z.strictObject({ setting: z.enum(CARE_SETTINGS) });

export const carePackageItemSchema = z.strictObject({
  formCode: z.string(),
  /** Judul versi terbit terakhir; null bila formulir belum terbit. */
  formTitle: z.string().nullable(),
  required: z.boolean(),
  sortOrder: z.int(),
  active: z.boolean(),
});
export type CarePackageItem = z.infer<typeof carePackageItemSchema>;

/** `PUT /api/v1/care-packages/:setting/:formCode` (izin `forms.definition.write`): pasang/ubah butir paket. */
export const carePackageItemInputSchema = z.strictObject({
  required: z.boolean(),
  sortOrder: z.int().min(0).max(999),
  active: z.boolean(),
});
export type CarePackageItemInput = z.infer<typeof carePackageItemInputSchema>;

/** `GET /api/v1/encounters/:id/completeness`: formulir paket setting kunjungan dan isian terkininya. */
export const encounterCompletenessSchema = z.strictObject({
  encounterId: uuid,
  setting: z.enum(CARE_SETTINGS),
  complete: z.boolean(),
  /** Jumlah formulir wajib yang sudah / harus diisi. */
  requiredFilled: z.int().min(0),
  requiredTotal: z.int().min(0),
  items: z.array(
    z.strictObject({
      formCode: z.string(),
      formTitle: z.string().nullable(),
      required: z.boolean(),
      filled: z.boolean(),
      responseId: uuid.nullable(),
      filledAt: instant.nullable(),
    }),
  ),
});
export type EncounterCompleteness = z.infer<typeof encounterCompletenessSchema>;
