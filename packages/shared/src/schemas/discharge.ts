import { z } from 'zod';
import { SIGNATURE_STATUSES } from '../documents';
import { icd10CodingSchema } from './front-office';
import { clinicalAuthorSchema, SAFETY_REASON_MIN } from './klinis';
import {
  DISCHARGE_DISPOSITIONS,
  type DischargeDisposition,
  dischargeSummarySchema,
  RESUME_CHECK_IDS,
  type ResumeCheckId,
} from './rawat-inap';

/**
 * K13 · Kontrak API resume medis, rekonsiliasi obat pulang, surat keterangan kematian, dan tutup kunjungan (fase 3
 * potongan 3.6, EP 5c). Bentuk isi resume = kontrak mode presentasi `dischargeSummarySchema` (ADR-0023 keputusan 4),
 * sehingga layar Resume memakai komponen yang sama di kedua mode; tambahan jalur api (ref sumber per bagian, status
 * draf/final, TTE, addendum) ada di `dischargeSummaryViewSchema`.
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().trim().max(max);

/** Bagian resume (urutan tetap). Diagnosis dan prosedur berkode ada di `codes`, bukan bagian teks. */
export const DISCHARGE_SECTION_IDS = [
  'anamnesis',
  'fisik',
  'penunjang',
  'terapi',
  'obat-pulang',
  'edukasi',
  'instruksi',
  'tindak-lanjut',
] as const;
export type DischargeSectionId = (typeof DISCHARGE_SECTION_IDS)[number];

/** Bagian yang dihimpun dari sumber; DPJP boleh menambah catatan (mis. "tidak ada pemeriksaan penunjang"). */
export const DISCHARGE_NOTE_SECTIONS = ['anamnesis', 'fisik', 'penunjang', 'terapi'] as const;
export type DischargeNoteSection = (typeof DISCHARGE_NOTE_SECTIONS)[number];

/** Jenis resume: rawat inap (12 butir) atau rawat jalan ringkas untuk penutupan poli. */
export const DISCHARGE_SUMMARY_KINDS = ['rawat_inap', 'rawat_jalan'] as const;
export type DischargeSummaryKind = (typeof DISCHARGE_SUMMARY_KINDS)[number];

/** Butir wajib resume rawat jalan ringkas (subset 12 butir; rekonsiliasi dan edukasi khusus rawat inap). */
export const RESUME_RJ_CHECK_IDS = [
  'ident',
  'anamnesis',
  'fisik',
  'diagnosis',
  'prosedur',
  'terapi',
  'kontrol',
  'kondisi',
] as const satisfies readonly ResumeCheckId[];

export function resumeRequiredChecks(kind: DischargeSummaryKind): readonly ResumeCheckId[] {
  return kind === 'rawat_inap' ? RESUME_CHECK_IDS : RESUME_RJ_CHECK_IDS;
}

/** Tabel sumber yang boleh dirujuk bagian resume (`discharge_summary_sources.source_type`). */
export const DISCHARGE_SOURCE_TYPES = [
  'encounters',
  'form_responses',
  'cppt_entries',
  'observations',
  'diagnostic_reports',
  'conditions',
  'procedures',
  'medication_requests',
  'medication_administrations',
  'referrals',
] as const;
export type DischargeSourceType = (typeof DISCHARGE_SOURCE_TYPES)[number];

export const dischargeSourceRefSchema = z.strictObject({
  type: z.enum(DISCHARGE_SOURCE_TYPES),
  id: uuid,
});
export type DischargeSourceRef = z.infer<typeof dischargeSourceRefSchema>;

/** Perubahan obat pada rekonsiliasi pulang (kontrak demo memakai `ubah-dosis`; DB `ubah_dosis`). */
export const DISCHARGE_MEDICATION_CHANGES = ['baru', 'lanjut', 'ubah-dosis', 'dihentikan'] as const;
export type DischargeMedicationChange = (typeof DISCHARGE_MEDICATION_CHANGES)[number];

export const dischargeMedicationLineSchema = z.strictObject({
  /** Order obat asal (lanjut/ubah dosis/dihentikan); null untuk obat baru atau obat rutin sebelum masuk. */
  medicationRequestId: uuid.nullable(),
  name: z.string().trim().min(1).max(80),
  sig: z.string().trim().min(1).max(80),
  change: z.enum(DISCHARGE_MEDICATION_CHANGES),
});
export type DischargeMedicationLine = z.infer<typeof dischargeMedicationLineSchema>;

/**
 * Isian DPJP pada draf resume (`PUT /discharge/summaries/:encounterId/draft`). Bagian yang dihimpun dari sumber tidak
 * bisa ditimpa; DPJP hanya menambah catatan. Mengubah daftar obat membatalkan konfirmasi rekonsiliasi.
 */
export const dischargeDraftInputSchema = z.strictObject({
  /** Rencana/waktu pulang; null = belum direncanakan (rawat jalan: waktu tanda tangan). */
  dischargeAt: instant.nullable(),
  disposition: z.enum(DISCHARGE_DISPOSITIONS).nullable(),
  /** Kondisi pulang singkat, mis. "Membaik", "Sembuh". */
  dischargeCondition: text(40).nullable(),
  notes: z.strictObject({
    anamnesis: text(1200).nullable(),
    fisik: text(1200).nullable(),
    penunjang: text(1200).nullable(),
    terapi: text(1200).nullable(),
  }),
  education: text(1200).nullable(),
  instructions: text(1200).nullable(),
  followUp: text(1000).nullable(),
  medications: z.array(dischargeMedicationLineSchema).max(40),
});
export type DischargeDraftInput = z.infer<typeof dischargeDraftInputSchema>;

export const dischargeDraftCreateInputSchema = z.strictObject({ encounterId: uuid });

/** Konfirmasi (atau batal) rekonsiliasi obat pulang oleh DPJP atas daftar obat draf saat ini. */
export const dischargeReconciliationInputSchema = z.strictObject({ confirmed: z.boolean() });

/**
 * Finalisasi resume (`clinical.sign`): server menghimpun ulang sumber, memeriksa butir wajib, menyimpan versi, lalu
 * PDF + TTE (terkunci). Koreksi hanya atas versi yang TTE-nya gagal; versi ber-TTE → 409 `RECORD_LOCKED`.
 */
/** Revisi dokumen pulang ber-TTE: baru, atau koreksi beralasan atas versi yang TTE-nya gagal. */
export const signedRevisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('baru') }),
  z.strictObject({
    kind: z.literal('koreksi'),
    supersedesId: uuid,
    correctionReason: z.string().trim().min(SAFETY_REASON_MIN).max(500),
  }),
]);

export const dischargeFinalizeInputSchema = z.strictObject({ revision: signedRevisionSchema });
export type DischargeFinalizeInput = z.infer<typeof dischargeFinalizeInputSchema>;

/** Addendum atas resume final (TTE sendiri); isi asli tidak berubah. */
export const dischargeAddendumInputSchema = z.strictObject({
  text: z.string().trim().min(SAFETY_REASON_MIN).max(2000),
});
export type DischargeAddendumInput = z.infer<typeof dischargeAddendumInputSchema>;

export const dischargeDocumentRefSchema = z.strictObject({
  id: uuid,
  title: z.string(),
  /** Status TTE terakhir; null bila dokumen tanpa permintaan TTE. */
  signatureStatus: z.enum(SIGNATURE_STATUSES).nullable(),
});
export type DischargeDocumentRef = z.infer<typeof dischargeDocumentRefSchema>;

export const dischargeAddendumSchema = z.strictObject({
  id: uuid,
  text: z.string(),
  author: clinicalAuthorSchema,
  recordedAt: instant,
  document: dischargeDocumentRefSchema.nullable(),
});
export type DischargeAddendum = z.infer<typeof dischargeAddendumSchema>;

/**
 * Jawaban `GET /encounters/:id/discharge-summary` dan semua aksi resume. `summary` = bentuk kontrak demo (komponen
 * layar bersama). `state`: `belum` (belum ada draf/final milik Anda; isi = himpunan sumber terkini), `draf`, `final`.
 */
export const dischargeSummaryViewSchema = z.strictObject({
  encounterId: uuid,
  patientId: uuid,
  encounterNumber: z.string(),
  encounterClass: z.enum(['AMB', 'EMER', 'IMP']),
  encounterStatus: z.string(),
  kind: z.enum(DISCHARGE_SUMMARY_KINDS),
  state: z.enum(['belum', 'draf', 'final']),
  summary: dischargeSummarySchema,
  /** Butir wajib untuk jenis resume ini (urutan tetap). */
  requiredChecks: z.array(z.enum(RESUME_CHECK_IDS)),
  /** Ref sumber per bagian (tabel + id baris). */
  sectionRefs: z.record(z.string(), z.array(dischargeSourceRefSchema)),
  /** Catatan DPJP per bagian sumber (draf). */
  notes: dischargeDraftInputSchema.shape.notes,
  draft: dischargeDraftInputSchema.nullable(),
  disposition: z.enum(DISCHARGE_DISPOSITIONS).nullable(),
  medications: z.array(dischargeMedicationLineSchema),
  reconciliation: z.strictObject({ confirmedAt: instant, confirmedBy: z.string() }).nullable(),
  final: z
    .strictObject({
      id: uuid,
      rootId: uuid,
      version: z.int().min(1),
      recordedAt: instant,
      author: clinicalAuthorSchema,
      document: dischargeDocumentRefSchema.nullable(),
      /** Versi ber-TTE (pending/signed): tidak bisa digantikan, hanya addendum. */
      locked: z.boolean(),
    })
    .nullable(),
  addenda: z.array(dischargeAddendumSchema),
  /** Pengguna sesi boleh konfirmasi rekonsiliasi dan TTE (DPJP/rawat bersama/dokter kunjungan + `clinical.sign`). */
  canSign: z.boolean(),
});
export type DischargeSummaryView = z.infer<typeof dischargeSummaryViewSchema>;

// ---------------------------------------------------------------------------------------------------------------
// K13 · Surat keterangan kematian (keputusan K-1, 7 Okt 2026) dan tutup kunjungan
// ---------------------------------------------------------------------------------------------------------------

/**
 * `POST /encounters/:id/death-certificate` (`clinical.sign`): hanya dokter yang berelasi dengan pasien (DPJP, rawat
 * bersama, dokter jaga yang punya akses). Jam kematian + sebab kematian ICD-10 (kode dari data rujukan) wajib; PDF
 * surat keterangan kematian ber-TTE dokter.
 */
export const deathCertificateInputSchema = z.strictObject({
  /** Baru, atau koreksi beralasan bila TTE versi sebelumnya gagal (versi ber-TTE → 409 `RECORD_LOCKED`). */
  revision: signedRevisionSchema,
  diedAt: instant,
  cause: icd10CodingSchema,
  /** Rangkaian sebab/keterangan klinis (opsional). */
  note: text(500).nullable(),
});
export type DeathCertificateInput = z.infer<typeof deathCertificateInputSchema>;

export const deathCertificateSchema = z.strictObject({
  id: uuid,
  rootId: uuid,
  version: z.int().min(1),
  /** Versi ber-TTE (pending/signed): tidak bisa digantikan. */
  locked: z.boolean(),
  encounterId: uuid,
  patientId: uuid,
  diedAt: instant,
  cause: icd10CodingSchema,
  note: z.string().nullable(),
  author: clinicalAuthorSchema,
  recordedAt: instant,
  document: dischargeDocumentRefSchema.nullable(),
});
export type DeathCertificate = z.infer<typeof deathCertificateSchema>;

/** `POST /encounters/:id/close`: tutup kunjungan lewat `DischargeGate` (rawat jalan, IGD, rawat inap). */
export const encounterCloseInputSchema = z.strictObject({ disposition: z.enum(DISCHARGE_DISPOSITIONS) });
export type EncounterCloseInput = z.infer<typeof encounterCloseInputSchema>;

export const encounterCloseResultSchema = z.strictObject({
  encounterId: uuid,
  disposition: z.enum(DISCHARGE_DISPOSITIONS),
  /** Tiket poli yang diselesaikan (memicu task 5 Antrean BPJS), bila ada. */
  queueTicketId: uuid.nullable(),
  bedId: uuid.nullable(),
});
export type EncounterCloseResult = z.infer<typeof encounterCloseResultSchema>;

/** Label disposisi (cara pulang) untuk resume, PDF, dan layar. */
export const DISPOSITION_LABEL: Readonly<Record<DischargeDisposition, string>> = {
  pulang: 'Pulang atas persetujuan dokter',
  rujuk: 'Dirujuk',
  pulang_paksa: 'Pulang atas permintaan sendiri',
  meninggal: 'Meninggal',
  pindah_rawat: 'Pindah rawat',
};
