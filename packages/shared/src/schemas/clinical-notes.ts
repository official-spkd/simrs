import { z } from 'zod';
import { EWS_RISK_LEVELS } from '../clinical/ews';
import { clinicalAuthorSchema, clinicalEntryMetaSchema } from './klinis';

/**
 * K07 · K06 · K01 · Kontrak API CPPT (co-sign, verifikasi DPJP), serah terima SBAR, asesmen per kunjungan, dan
 * worklist klinis (fase 3 potongan 3.2b). Input/rekaman CPPT dan input serah terima ada di `rawat-inap.ts` (3.0a).
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });

export const encounterQuerySchema = z.strictObject({ encounterId: uuid });

/** Co-sign / verifikasi DPJP: atestasi elektronik sesi (keputusan fase 3 no. 2); catatan opsional. */
export const clinicalAttestationInputSchema = z.strictObject({
  note: z.string().trim().min(1).max(500).nullable(),
});
export type ClinicalAttestationInput = z.infer<typeof clinicalAttestationInputSchema>;

export const handoverRecordSchema = clinicalEntryMetaSchema.extend({
  patientId: uuid,
  encounterId: uuid,
  situation: z.string(),
  background: z.string(),
  assessment: z.string(),
  recommendation: z.string(),
  /** Penerima serah terima; null = shift/unit berikutnya secara umum. */
  toUser: clinicalAuthorSchema.omit({ peran: true }).nullable(),
});
export type HandoverRecord = z.infer<typeof handoverRecordSchema>;

// ---------------------------------------------------------------------------------------------------------------
// K06 · Asesmen per kunjungan (isian formulir P07 dengan `encounterId`)
// ---------------------------------------------------------------------------------------------------------------

export const encounterAssessmentSchema = z.strictObject({
  id: uuid,
  rootId: uuid,
  formCode: z.string(),
  formTitle: z.string(),
  formVersion: z.int().min(1),
  version: z.int().min(1),
  status: z.enum(['final', 'entered_in_error']),
  score: z.number().nullable(),
  scoreBand: z.string().nullable(),
  createdAt: instant,
  author: z.string().nullable(),
});
export type EncounterAssessment = z.infer<typeof encounterAssessmentSchema>;

// ---------------------------------------------------------------------------------------------------------------
// K01 · Worklist klinis
// ---------------------------------------------------------------------------------------------------------------

/**
 * Tampilan worklist: `dpjp` = pasien yang saya rawat sebagai DPJP/rawat bersama; `unit` = pasien yang kini berada di
 * unit penugasan; `shift` = pasien unit + serah terima untuk saya 12 jam terakhir; `tugas` = daftar tugas saja.
 */
export const WORKLIST_VIEWS = ['dpjp', 'unit', 'shift', 'tugas'] as const;
export type WorklistView = (typeof WORKLIST_VIEWS)[number];

export const worklistQuerySchema = z.strictObject({ view: z.enum(WORKLIST_VIEWS).default('tugas') });

/**
 * Jenis tugas: co-sign CPPT residen, verifikasi CPPT PPA lain lewat `cppt.verify_hours`, tinjau order residen, TTE
 * gagal, EWS tinggi, resume lewat `resume.deadline_hours`, serah terima untuk saya.
 */
export const WORKLIST_TASK_KINDS = [
  'cosign',
  'verify',
  'review_order',
  'tte_failed',
  'ews_high',
  'resume_overdue',
  'handover',
] as const;
export type WorklistTaskKind = (typeof WORKLIST_TASK_KINDS)[number];

export const worklistTaskSchema = z.strictObject({
  kind: z.enum(WORKLIST_TASK_KINDS),
  /** Null bila tugas tidak terikat kunjungan (mis. TTE dokumen pasien yang gagal). */
  encounterId: uuid.nullable(),
  patientId: uuid,
  patientName: z.string(),
  mrn: z.string(),
  /** Entri/dokumen/order yang perlu ditindaklanjuti. */
  targetId: uuid.nullable(),
  /** Sejak kapan tugas ada. */
  at: instant,
  /** Batas waktu (verifikasi DPJP, resume); null bila tanpa batas. */
  dueAt: instant.nullable(),
  overdue: z.boolean(),
  label: z.string().min(1),
});
export type WorklistTask = z.infer<typeof worklistTaskSchema>;

export const worklistPatientSchema = z.strictObject({
  encounterId: uuid,
  patientId: uuid,
  name: z.string(),
  mrn: z.string(),
  encounterNumber: z.string(),
  class: z.enum(['AMB', 'EMER', 'IMP']),
  unitName: z.string(),
  bed: z.string().nullable(),
  ews: z
    .strictObject({ score: z.int().min(0).max(20), risk: z.enum(EWS_RISK_LEVELS), at: instant })
    .nullable(),
  pendingTasks: z.int().min(0),
});
export type WorklistPatient = z.infer<typeof worklistPatientSchema>;

export const worklistSchema = z.strictObject({
  view: z.enum(WORKLIST_VIEWS),
  generatedAt: instant,
  patients: z.array(worklistPatientSchema),
  tasks: z.array(worklistTaskSchema),
});
export type Worklist = z.infer<typeof worklistSchema>;
