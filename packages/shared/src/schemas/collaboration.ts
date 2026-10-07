import { z } from 'zod';
import { clinicalAuthorSchema, clinicalEntryMetaSchema, clinicalRevisionSchema } from './klinis';

/**
 * K10 · K15 · Konsultasi/rawat bersama/alih rawat, tim perawatan, paket formulir per setting + kelengkapan asesmen
 * (fase 3 potongan 3.8, EP 6b/7a).
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().trim().max(max);

// ---------------------------------------------------------------------------------------------------------------
// K10 · Konsultasi
// ---------------------------------------------------------------------------------------------------------------

export const CONSULT_KINDS = ['konsultasi', 'rawat_bersama', 'alih_rawat'] as const;
export type ConsultKind = (typeof CONSULT_KINDS)[number];
export const CONSULT_URGENCIES = ['biasa', 'segera'] as const;

/** Konsultan (pengguna tujuan atau dokter unit tujuan yang menjawab) mendapat akses berbatas waktu ini. */
export const CONSULT_ACCESS_HOURS = 72;

/** `POST /api/v1/consults/requests` (berversi lewat `revision`). Tujuan: pengguna tertentu dan/atau unit. */
export const consultRequestInputSchema = z
  .strictObject({
    encounterId: uuid,
    occurredAt: instant,
    kind: z.enum(CONSULT_KINDS),
    urgency: z.enum(CONSULT_URGENCIES),
    toUserId: uuid.nullable(),
    toUnitId: uuid.nullable(),
    question: text(2000).min(1),
    revision: clinicalRevisionSchema,
  })
  .refine((v) => v.toUserId !== null || v.toUnitId !== null, {
    path: ['toUserId'],
    message: 'Pilih dokter atau unit tujuan konsultasi.',
  });
export type ConsultRequestInput = z.infer<typeof consultRequestInputSchema>;

/**
 * `POST /api/v1/consults/requests/:id/responses`. `accept` = konsultan menerima rawat bersama / alih rawat (tim
 * perawatan ikut berubah); diabaikan untuk konsultasi biasa.
 */
export const consultResponseInputSchema = z.strictObject({
  occurredAt: instant,
  findings: text(2000),
  assessment: text(2000).min(1),
  recommendation: text(2000).min(1),
  accept: z.boolean(),
  revision: clinicalRevisionSchema,
});
export type ConsultResponseInput = z.infer<typeof consultResponseInputSchema>;

export const consultResponseRecordSchema = clinicalEntryMetaSchema.extend({
  requestId: uuid,
  findings: z.string(),
  assessment: z.string(),
  recommendation: z.string(),
  accept: z.boolean(),
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
});
export type ConsultInboxItem = z.infer<typeof consultInboxItemSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Tim perawatan
// ---------------------------------------------------------------------------------------------------------------

export const CARE_TEAM_ROLES = ['dpjp_utama', 'rawat_bersama', 'konsultan', 'perawat_pj'] as const;
export type CareTeamRoleCode = (typeof CARE_TEAM_ROLES)[number];

export const careTeamMemberSchema = z.strictObject({
  id: uuid,
  user: z.strictObject({ userId: uuid, nama: z.string() }),
  role: z.enum(CARE_TEAM_ROLES),
  startedAt: instant,
  endedAt: instant.nullable(),
  endReason: z.string().nullable(),
});
export type CareTeamMember = z.infer<typeof careTeamMemberSchema>;

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
