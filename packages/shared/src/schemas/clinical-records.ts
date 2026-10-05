import { z } from 'zod';
import { EWS_RISK_LEVELS } from '../clinical/ews';
import {
  ALLERGY_CATEGORIES,
  ALLERGY_CRITICALITIES,
  CONDITION_CLINICAL_STATUSES,
  CONDITION_KINDS,
  CONDITION_ROLES,
  clinicalEntryMetaSchema,
  clinicalRevisionSchema,
  OBSERVATION_INTERPRETATIONS,
} from './klinis';

/**
 * K08 · K12 (observasi) · K14 · Kontrak jawaban API data klinis terkode (fase 3 potongan 3.2a): diagnosis, prosedur,
 * alergi + NKDA, problem list, hasil penunjang, konteks kunjungan (banner), dan ringkasan pasien. Input diagnosis,
 * prosedur, alergi, dan tanda vital ada di `klinis.ts` (potongan 3.0a). Semua entri berversi membawa
 * `clinicalEntryMetaSchema` (penulis dari sesi, dua stempel waktu, kunci TTE). Data fiktif di tes.
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const text = (max: number) => z.string().trim().max(max);

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, prosedur, alergi
// ---------------------------------------------------------------------------------------------------------------

export const conditionRecordSchema = clinicalEntryMetaSchema.extend({
  patientId: uuid,
  encounterId: uuid,
  kind: z.enum(CONDITION_KINDS),
  role: z.enum(CONDITION_ROLES).nullable(),
  code: z.string().min(1),
  /** Nama dari data rujukan `ref` (bukan ketikan klinisi). */
  display: z.string().min(1),
  clinicalStatus: z.enum(CONDITION_CLINICAL_STATUSES),
  note: z.string().nullable(),
});
export type ConditionRecord = z.infer<typeof conditionRecordSchema>;

export const procedureRecordSchema = clinicalEntryMetaSchema.extend({
  patientId: uuid,
  encounterId: uuid,
  code: z.string().min(1),
  display: z.string().min(1),
  note: z.string().nullable(),
});
export type ProcedureRecord = z.infer<typeof procedureRecordSchema>;

export const allergyRecordSchema = clinicalEntryMetaSchema.extend({
  patientId: uuid,
  encounterId: uuid.nullable(),
  kind: z.enum(['alergi', 'nkda']),
  substance: z.strictObject({ id: uuid, code: z.string(), name: z.string() }).nullable(),
  text: z.string().nullable(),
  category: z.enum(ALLERGY_CATEGORIES).nullable(),
  criticality: z.enum(ALLERGY_CRITICALITIES).nullable(),
  reaction: z.string().nullable(),
});
export type AllergyRecord = z.infer<typeof allergyRecordSchema>;

/**
 * Status alergi pasien (seluruh kelompok rekam medis): `ada` = ada alergi final terkini; `nkda` = tercatat eksplisit
 * tidak ada alergi obat; `belum_dikaji` = belum pernah dicatat (bukan sama dengan NKDA).
 */
export const ALLERGY_STATUSES = ['ada', 'nkda', 'belum_dikaji'] as const;
export type AllergyStatus = (typeof ALLERGY_STATUSES)[number];

export const patientAllergiesSchema = z.strictObject({
  status: z.enum(ALLERGY_STATUSES),
  allergies: z.array(allergyRecordSchema),
  nkda: allergyRecordSchema.nullable(),
});
export type PatientAllergies = z.infer<typeof patientAllergiesSchema>;

export const patientQuerySchema = z.strictObject({ patientId: uuid });

// ---------------------------------------------------------------------------------------------------------------
// Hasil penunjang (muara hasil, keputusan fase 3 no. 12): observasi + laporan diagnostik
// ---------------------------------------------------------------------------------------------------------------

/** Kategori hasil penunjang yang diinput `POST /results/*` (tanda vital lewat `/encounter/:id/observations`). */
export const RESULT_CATEGORIES = ['lab', 'imaging', 'survei'] as const;
export type ResultCategory = (typeof RESULT_CATEGORIES)[number];
export const DIAGNOSTIC_REPORT_CATEGORIES = ['lab', 'radiologi', 'lainnya'] as const;

/** Kode LOINC (mis. `2160-0`); hanya kode yang ada di data rujukan yang diterima (trigger `REF_CODE_UNKNOWN`). */
export const loincCodeSchema = z.string().regex(/^\d{1,7}-\d$/, 'Kode LOINC tidak valid');

/** Isi satu hasil: kode LOINC (nama dari `ref`) ATAU nama bebas bila belum terkode; nilai angka dan/atau teks. */
const resultValueFields = {
  category: z.enum(RESULT_CATEGORIES),
  code: loincCodeSchema.nullable(),
  /** Wajib bila `code` kosong; diabaikan bila `code` diisi (nama dari data rujukan). */
  display: text(200).min(1).nullable(),
  valueNumeric: z.number().finite().nullable(),
  valueUnit: text(20).min(1).nullable(),
  valueText: text(2000).min(1).nullable(),
  interpretation: z.enum(OBSERVATION_INTERPRETATIONS).nullable(),
  referenceRange: text(60).min(1).nullable(),
};

function refineResultValue(
  v: { code: string | null; display: string | null; valueNumeric: number | null; valueText: string | null },
  ctx: z.RefinementCtx,
) {
  if (v.code === null && v.display === null) {
    ctx.addIssue({ code: 'custom', path: ['display'], message: 'Isi kode LOINC atau nama pemeriksaan.' });
  }
  if (v.valueNumeric === null && v.valueText === null) {
    ctx.addIssue({ code: 'custom', path: ['valueNumeric'], message: 'Isi nilai angka atau teks hasil.' });
  }
}

export const resultObservationItemSchema = z.strictObject(resultValueFields).superRefine(refineResultValue);
export type ResultObservationItem = z.infer<typeof resultObservationItemSchema>;

/** `POST /api/v1/results/observations` (izin `result.write`). Berversi: koreksi/addendum lewat `revision`. */
export const resultObservationInputSchema = z
  .strictObject({
    encounterId: uuid,
    occurredAt: instant,
    ...resultValueFields,
    diagnosticReportId: uuid.nullable(),
    revision: clinicalRevisionSchema,
  })
  .superRefine(refineResultValue);
export type ResultObservationInput = z.infer<typeof resultObservationInputSchema>;

/**
 * `POST /api/v1/results/reports`: laporan diagnostik + hasil-hasilnya sekaligus (versi 1). Koreksi laporan
 * (`revision` koreksi) hanya mengubah judul/kesimpulan; hasil tetap terhubung ke rantai laporan dan dikoreksi sendiri.
 */
export const resultReportInputSchema = z
  .strictObject({
    encounterId: uuid,
    occurredAt: instant,
    category: z.enum(DIAGNOSTIC_REPORT_CATEGORIES),
    code: loincCodeSchema.nullable(),
    display: text(200).min(1).nullable(),
    conclusion: text(4000).min(1).nullable(),
    observations: z.array(resultObservationItemSchema).max(50),
    revision: clinicalRevisionSchema,
  })
  .superRefine((v, ctx) => {
    if (v.code === null && v.display === null) {
      ctx.addIssue({ code: 'custom', path: ['display'], message: 'Isi kode LOINC atau nama laporan.' });
    }
    if (v.revision.kind !== 'baru' && v.observations.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'Koreksi/addendum laporan tidak membawa hasil baru; koreksi hasil satu per satu.',
      });
    }
    if (v.revision.kind === 'baru' && v.observations.length === 0 && v.conclusion === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'Laporan wajib berisi hasil atau kesimpulan.',
      });
    }
  });
export type ResultReportInput = z.infer<typeof resultReportInputSchema>;

export const resultObservationRecordSchema = clinicalEntryMetaSchema.extend({
  patientId: uuid,
  encounterId: uuid,
  category: z.enum(RESULT_CATEGORIES),
  code: z.string().nullable(),
  display: z.string().min(1),
  valueNumeric: z.number().nullable(),
  valueUnit: z.string().nullable(),
  valueText: z.string().nullable(),
  interpretation: z.enum(OBSERVATION_INTERPRETATIONS).nullable(),
  referenceRange: z.string().nullable(),
  diagnosticReportId: uuid.nullable(),
});
export type ResultObservationRecord = z.infer<typeof resultObservationRecordSchema>;

export const diagnosticReportRecordSchema = clinicalEntryMetaSchema.extend({
  patientId: uuid,
  encounterId: uuid,
  category: z.enum(DIAGNOSTIC_REPORT_CATEGORIES),
  code: z.string().nullable(),
  display: z.string().min(1),
  conclusion: z.string().nullable(),
  /** Hasil terkini milik rantai laporan ini. */
  observations: z.array(resultObservationRecordSchema),
});
export type DiagnosticReportRecord = z.infer<typeof diagnosticReportRecordSchema>;

/** `GET /api/v1/results?patientId=` (kelompok rekam medis), terbaru dulu. */
export const patientResultsQuerySchema = z.strictObject({
  patientId: uuid,
  encounterId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export const patientResultsSchema = z.strictObject({
  reports: z.array(diagnosticReportRecordSchema),
  /** Hasil tanpa laporan. */
  observations: z.array(resultObservationRecordSchema),
});
export type PatientResults = z.infer<typeof patientResultsSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Konteks kunjungan (banner pasien, CLAUDE.md §6) dan ringkasan pasien (K14)
// ---------------------------------------------------------------------------------------------------------------

const ewsSummarySchema = z.strictObject({
  score: z.int().min(0).max(20),
  maxParam: z.int().min(0).max(3),
  risk: z.enum(EWS_RISK_LEVELS),
  at: instant,
});

export const patientBannerSchema = z.strictObject({
  id: uuid,
  name: z.string().min(1),
  mrn: z.string().min(1),
  sex: z.enum(['male', 'female', 'unknown']),
  birthDate: isoDate.nullable(),
  /** Umur dalam tahun (WIB hari ini); null bila tanggal lahir tidak diketahui. */
  ageYears: z.int().min(0).nullable(),
  unidentified: z.boolean(),
  confidential: z.boolean(),
});
export type PatientBanner = z.infer<typeof patientBannerSchema>;

/** Ringkasan alergi untuk banner: status + label pendek (`Amoksisilin · tinggi`), bukan hanya warna. */
export const allergyBannerSchema = z.strictObject({
  status: z.enum(ALLERGY_STATUSES),
  labels: z.array(z.string()),
});

/** `GET /api/v1/encounter/:id/context` · banner pasien di setiap layar klinis. */
export const encounterContextSchema = z.strictObject({
  patient: patientBannerSchema,
  encounter: z.strictObject({
    id: uuid,
    number: z.string(),
    class: z.enum(['AMB', 'EMER', 'IMP']),
    status: z.enum(['planned', 'arrived', 'in_progress', 'finished', 'cancelled']),
    unit: z.strictObject({ id: uuid, name: z.string() }),
    /** Bed yang ditempati sekarang (rawat inap/IGD), null bila belum/tanpa bed. */
    bed: z.strictObject({ id: uuid, code: z.string(), name: z.string() }).nullable(),
    arrivedAt: instant.nullable(),
    startedAt: instant.nullable(),
  }),
  /** DPJP utama tim perawatan, atau DPJP kunjungan. */
  dpjp: z.strictObject({ name: z.string() }).nullable(),
  /** Penjamin utama aktif. */
  coverage: z.strictObject({ kind: z.string(), name: z.string() }).nullable(),
  allergy: allergyBannerSchema,
  primaryDiagnosis: z.strictObject({ code: z.string(), display: z.string() }).nullable(),
  latestEws: ewsSummarySchema.nullable(),
});
export type EncounterContext = z.infer<typeof encounterContextSchema>;

/** `GET /api/v1/summary/patients/:id` (K14): ringkasan lintas kunjungan, kelompok rekam medis (ADR-0016). */
export const patientSummarySchema = z.strictObject({
  patient: patientBannerSchema,
  allergies: patientAllergiesSchema,
  activeProblems: z.array(conditionRecordSchema),
  encounters: z.array(
    z.strictObject({
      id: uuid,
      number: z.string(),
      class: z.enum(['AMB', 'EMER', 'IMP']),
      status: z.string(),
      unitName: z.string(),
      at: instant,
      primaryDiagnosis: z.strictObject({ code: z.string(), display: z.string() }).nullable(),
    }),
  ),
  latestVitals: z
    .strictObject({
      encounterId: uuid,
      at: instant,
      values: z.record(z.string(), z.unknown()),
      ews: ewsSummarySchema.nullable(),
    })
    .nullable(),
  recentResults: z.array(resultObservationRecordSchema),
  recentProcedures: z.array(procedureRecordSchema),
  /** Obat dari order aktif (status terakhir `aktif`). */
  activeMedications: z.array(
    z.strictObject({
      id: uuid,
      encounterId: uuid,
      name: z.string(),
      sig: z.string(),
      highAlert: z.boolean(),
      orderedAt: instant,
    }),
  ),
});
export type PatientSummary = z.infer<typeof patientSummarySchema>;
