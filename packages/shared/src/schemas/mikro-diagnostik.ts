import { z } from 'zod';
import { type CreateFormDefinitionInput, formAnswersSchema } from '../forms';
import { supportPatientLiteSchema, SUPPORT_VIEWS } from './gizi-darah';
import { clinicalEntryMetaSchema, clinicalRevisionSchema } from './klinis';
import {
  DIAGNOSTIC_KINDS,
  type DiagnosticKind,
  diagnosticReportInputSchema,
  MICRO_REPORT_STAGES,
  microIsolateInputSchema,
  paReportInputSchema,
  SUSCEPTIBILITY_RESULTS,
} from './penunjang-api';

/**
 * S02 Mikrobiologi/PA + S10 Diagnostik lain · kontrak API potongan 4.8 (ADR-0120). Masukan dasar ada di
 * `penunjang-api.ts` (4.0a); di sini perluasan (tahap isolat, laporan tahap ber-validasi dua tingkat, versi PA,
 * waktu kejadian) dan rekaman jawaban API.
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const person = z.strictObject({ id: uuid, name: z.string() });

// ═════════════════════════════ S02 · Mikrobiologi ═════════════════════════════

/** Kode panel uji kultur di `lab_test_definitions.panel_code` (seed: kultur darah, urin, sputum, pus). */
export const MICRO_PANEL_CODE = 'MIKRO';

export const MICRO_STAGE_LABEL: Record<(typeof MICRO_REPORT_STAGES)[number], string> = {
  awal: 'Laporan awal (pewarnaan/pertumbuhan)',
  akhir: 'Laporan akhir (identifikasi + uji kepekaan)',
};

/** Isolat per tahap: laporan awal tanpa uji kepekaan; laporan akhir boleh dengan S/I/R + MIC. */
export const microIsolateStageInputSchema = microIsolateInputSchema
  .extend({ stage: z.enum(MICRO_REPORT_STAGES) })
  .refine((v) => v.stage === 'akhir' || v.susceptibilities.length === 0, {
    message: 'Uji kepekaan hanya di laporan akhir',
    path: ['susceptibilities'],
  });
export type MicroIsolateStageInput = z.infer<typeof microIsolateStageInputSchema>;

/** Validasi teknis (analis, `lab.result.verify`) satu tahap laporan; kesimpulan wajib (mis. "Tidak ada pertumbuhan"). */
export const microTechnicalInputSchema = z.strictObject({
  labOrderId: uuid,
  stage: z.enum(MICRO_REPORT_STAGES),
  conclusion: z.string().trim().min(3).max(2000),
});
export type MicroTechnicalInput = z.infer<typeof microTechnicalInputSchema>;

export const microSusceptibilityRecordSchema = z.strictObject({
  antibioticCode: z.string(),
  result: z.enum(SUSCEPTIBILITY_RESULTS),
  micValue: z.number().nullable(),
});

export const microIsolateRecordSchema = z.strictObject({
  id: uuid,
  stage: z.enum(MICRO_REPORT_STAGES),
  organismCode: z.string(),
  growth: z.string(),
  recordedBy: person,
  recordedAt: instant,
  susceptibilities: z.array(microSusceptibilityRecordSchema),
});
export type MicroIsolateRecord = z.infer<typeof microIsolateRecordSchema>;

export const microReportRecordSchema = z.strictObject({
  id: uuid,
  stage: z.enum(MICRO_REPORT_STAGES),
  conclusion: z.string(),
  technicalBy: person,
  technicalAt: instant,
  clinicalBy: person.nullable(),
  clinicalAt: instant.nullable(),
  /** Dokumen PDF ber-TTE rilis klinis (null sebelum dirilis). */
  documentId: uuid.nullable(),
});
export type MicroReportRecord = z.infer<typeof microReportRecordSchema>;

export const microOrderRecordSchema = z.strictObject({
  labOrderId: uuid,
  labNo: z.string(),
  encounterId: uuid,
  patient: supportPatientLiteSchema,
  priority: z.string(),
  status: z.string(),
  acceptedAt: instant,
  tests: z.array(z.strictObject({ code: z.string(), name: z.string(), specimenType: z.string() })),
  isolates: z.array(microIsolateRecordSchema),
  reports: z.array(microReportRecordSchema),
});
export type MicroOrderRecord = z.infer<typeof microOrderRecordSchema>;

export const microWorklistSchema = z.strictObject({
  serverNow: instant,
  view: z.enum(SUPPORT_VIEWS),
  orders: z.array(microOrderRecordSchema),
});
export type MicroWorklist = z.infer<typeof microWorklistSchema>;

export const antibiogramQuerySchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
});
export type AntibiogramQuery = z.infer<typeof antibiogramQuerySchema>;

/** Antibiogram kumulatif (sumber PPRA fase 8): isolat pertama per pasien × organisme di periode, laporan akhir dirilis. */
export const antibiogramSchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
  rows: z.array(
    z.strictObject({
      organismCode: z.string(),
      isolates: z.int().min(0),
      antibiotics: z.array(
        z.strictObject({
          antibioticCode: z.string(),
          tested: z.int().min(0),
          susceptible: z.int().min(0),
          intermediate: z.int().min(0),
          resistant: z.int().min(0),
          /** % S dibulatkan; null bila diuji < 1. */
          percentSusceptible: z.number().nullable(),
        }),
      ),
    }),
  ),
});
export type Antibiogram = z.infer<typeof antibiogramSchema>;

// ═════════════════════════════ S02 · Patologi anatomi ═════════════════════════════

/** Laporan PA berversi (ADR-0028): baru/koreksi/addendum; gambar = dokumen pasien (P08). */
export const paReportCreateInputSchema = paReportInputSchema.extend({
  occurredAt: instant,
  revision: clinicalRevisionSchema,
  imageDocumentIds: z.array(uuid).max(20),
  /** Spesimen kamar operasi (4.7b): kasus operasi diisi server dari spesimen; null = spesimen non-OK. */
  surgerySpecimenId: uuid.nullable(),
});
export type PaReportCreateInput = z.infer<typeof paReportCreateInputSchema>;

export const paReportRecordSchema = z.strictObject({
  meta: clinicalEntryMetaSchema,
  encounterId: uuid,
  patient: supportPatientLiteSchema,
  surgeryCaseId: uuid.nullable(),
  specimenSite: z.string(),
  macroscopic: z.string(),
  microscopic: z.string(),
  diagnosis: z.string(),
  icd10: z.string().nullable(),
  imageDocumentIds: z.array(uuid),
  surgerySpecimenId: uuid.nullable(),
  /** PDF ber-TTE versi ini (null = belum ditandatangani). */
  documentId: uuid.nullable(),
});
export type PaReportRecord = z.infer<typeof paReportRecordSchema>;

/** Worklist PA: spesimen kamar operasi yang dikirim (4.7b) beserta laporan PA terkininya. */
export const paWorklistSchema = z.strictObject({
  serverNow: instant,
  view: z.enum(SUPPORT_VIEWS),
  items: z.array(
    z.strictObject({
      surgerySpecimenId: uuid,
      labelNo: z.string(),
      site: z.string(),
      examination: z.string(),
      clinicalNote: z.string(),
      cito: z.boolean(),
      sentAt: instant,
      encounterId: uuid,
      surgeryCaseId: uuid,
      patient: supportPatientLiteSchema,
      report: paReportRecordSchema.nullable(),
    }),
  ),
});
export type PaWorklist = z.infer<typeof paWorklistSchema>;

// ═════════════════════════════ S10 · Diagnostik lain ═════════════════════════════

export const DIAGNOSTIC_KIND_LABEL: Record<DiagnosticKind, string> = {
  ekg: 'EKG',
  usg: 'USG',
  echo: 'Ekokardiografi',
  endoskopi: 'Endoskopi',
  treadmill: 'Treadmill (uji latih jantung)',
};

/** Kode ICD-9-CM order (F3-1) per jenis: order yang kodenya diawali salah satu ini masuk worklist S10. */
export const DIAGNOSTIC_KIND_CODES: Record<DiagnosticKind, readonly string[]> = {
  ekg: ['89.52'],
  usg: ['88.7'],
  echo: ['88.72'],
  endoskopi: ['45.1', '45.2'],
  treadmill: ['89.41', '89.42', '89.43', '89.44'],
};

/** Jenis diagnostik untuk kode ICD-9-CM order (prefiks terpanjang menang; echo 88.72 sebelum USG 88.7). */
export function diagnosticKindOf(code: string | null): DiagnosticKind | null {
  if (!code) return null;
  let best: { kind: DiagnosticKind; len: number } | null = null;
  for (const kind of DIAGNOSTIC_KINDS) {
    for (const p of DIAGNOSTIC_KIND_CODES[kind]) {
      if (code.startsWith(p) && (!best || p.length > best.len)) best = { kind, len: p.length };
    }
  }
  return best?.kind ?? null;
}

/**
 * S10: isian formulir `diag_<jenis>` untuk satu order, diisi dokter pelaksana lewat modul diagnostik (akses mengikuti
 * tampilan layanan penunjang, bukan relasi pasien). Jawaban: `{ formResponseId }`.
 */
export const diagnosticFormInputSchema = z.strictObject({ answers: formAnswersSchema });
export type DiagnosticFormInput = z.infer<typeof diagnosticFormInputSchema>;

/** S10: masukan laporan + waktu kejadian (pemeriksaan selesai). */
export const diagnosticReportCreateInputSchema = diagnosticReportInputSchema.extend({ occurredAt: instant });
export type DiagnosticReportCreateInput = z.infer<typeof diagnosticReportCreateInputSchema>;

export const diagnosticReportS10Schema = z.strictObject({
  meta: clinicalEntryMetaSchema,
  encounterId: uuid,
  serviceRequestId: uuid.nullable(),
  kind: z.enum(DIAGNOSTIC_KINDS).nullable(),
  display: z.string(),
  conclusion: z.string().nullable(),
  formResponseId: uuid.nullable(),
  documentIds: z.array(uuid),
  documentId: uuid.nullable(),
});
export type DiagnosticReportS10 = z.infer<typeof diagnosticReportS10Schema>;

export const diagnosticWorklistItemSchema = z.strictObject({
  serviceRequestId: uuid,
  encounterId: uuid,
  patient: supportPatientLiteSchema,
  kind: z.enum(DIAGNOSTIC_KINDS),
  name: z.string(),
  priority: z.string(),
  orderedAt: instant,
  report: diagnosticReportS10Schema.nullable(),
});
export type DiagnosticWorklistItem = z.infer<typeof diagnosticWorklistItemSchema>;

export const diagnosticWorklistSchema = z.strictObject({
  serverNow: instant,
  view: z.enum(SUPPORT_VIEWS),
  items: z.array(diagnosticWorklistItemSchema),
});
export type DiagnosticWorklist = z.infer<typeof diagnosticWorklistSchema>;

// ═════════════════════════════ Formulir P07 S10 (seed) ═════════════════════════════

const diagForm = (
  kind: DiagnosticKind,
  title: string,
  fields: CreateFormDefinitionInput['schema']['sections'][number]['fields'],
): CreateFormDefinitionInput => ({
  code: `diag_${kind}`,
  title,
  category: 'medis',
  writeRoles: ['dokter'],
  changeNote: 'Formulir contoh diagnostik lain (fase 4 · 4.8)',
  schema: { sections: [{ title: 'Temuan', fields }] },
});

const text = (key: string, label: string, required = true) => ({
  key,
  type: 'textarea' as const,
  label,
  required,
  summary: required,
});
const single = (key: string, label: string, options: Array<[string, string]>) => ({
  key,
  type: 'single' as const,
  label,
  required: true,
  summary: true,
  options: options.map(([value, l]) => ({ value, label: l })),
});

/** Lima formulir P07 S10 (kode `diag_<jenis>`); isian diserahkan bersama laporan (`formResponseId`). */
export const DIAGNOSTIC_FORMS: Record<DiagnosticKind, CreateFormDefinitionInput> = {
  ekg: diagForm('ekg', 'Laporan EKG 12 sadapan', [
    single('irama', 'Irama', [
      ['sinus', 'Sinus'],
      ['af', 'Fibrilasi atrium'],
      ['lain', 'Lainnya'],
    ]),
    { key: 'laju', type: 'number', label: 'Laju jantung (x/menit)', required: true, summary: true },
    text('temuan', 'Temuan (aksis, interval, ST-T)'),
  ]),
  usg: diagForm('usg', 'Laporan USG', [text('organ', 'Organ yang diperiksa'), text('temuan', 'Temuan')]),
  echo: diagForm('echo', 'Laporan ekokardiografi', [
    { key: 'ef', type: 'number', label: 'Fraksi ejeksi (%)', required: true, summary: true },
    text('katup', 'Katup'),
    text('temuan', 'Temuan lain', false),
  ]),
  endoskopi: diagForm('endoskopi', 'Laporan endoskopi', [
    single('jenis', 'Jenis', [
      ['egd', 'Esofagogastroduodenoskopi'],
      ['kolonoskopi', 'Kolonoskopi'],
    ]),
    text('temuan', 'Temuan'),
    single('biopsi', 'Biopsi', [
      ['tidak', 'Tidak'],
      ['ya', 'Ya, dikirim ke PA'],
    ]),
  ]),
  treadmill: diagForm('treadmill', 'Laporan uji latih jantung (treadmill)', [
    single('protokol', 'Protokol', [
      ['bruce', 'Bruce'],
      ['bruce_modif', 'Bruce modifikasi'],
    ]),
    single('hasil', 'Hasil', [
      ['negatif', 'Negatif iskemia'],
      ['positif', 'Positif iskemia'],
      ['tidak_konklusif', 'Tidak konklusif'],
    ]),
    text('temuan', 'Temuan'),
  ]),
};
