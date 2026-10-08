import { z } from 'zod';

/**
 * S06 → S02 · Kontrak spesimen operasi untuk patologi anatomi (fase 4 §4.7b, ADR-0106). Kamar operasi (A4) menyimpan
 * spesimen terstruktur di `surgery_specimens` (append-only) dan menerbitkan event `surgery.specimen_sent` per spesimen.
 * Order PA (S02, fase 4 §4.8) dibuat penangan event itu: penangan membaca baris `surgery_specimens` lewat
 * `surgerySpecimenId` (isi klinis tidak ikut di muatan event) dan mengisi `pa_reports.surgery_case_id` dari kasusnya.
 *
 * Token di sini = CHECK database (`surgery_specimens_values_valid`). Mengubah daftar berarti migrasi + ubah berkas ini.
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });

/** Jenis pemeriksaan yang diminta dari kamar operasi. */
export const SURGERY_SPECIMEN_EXAMS = [
  'histopatologi',
  'potong_beku',
  'sitologi',
  'imunohistokimia',
] as const;
export type SurgerySpecimenExam = (typeof SURGERY_SPECIMEN_EXAMS)[number];
export const SURGERY_SPECIMEN_EXAM_LABEL: Record<SurgerySpecimenExam, string> = {
  histopatologi: 'Histopatologi',
  potong_beku: 'Potong beku (intraoperatif)',
  sitologi: 'Sitologi',
  imunohistokimia: 'Imunohistokimia',
};

/** Fiksatif wadah. Potong beku dikirim segar (`segar`). */
export const SURGERY_SPECIMEN_FIXATIVES = ['formalin_10', 'segar', 'alkohol_95', 'lainnya'] as const;
export type SurgerySpecimenFixative = (typeof SURGERY_SPECIMEN_FIXATIVES)[number];
export const SURGERY_SPECIMEN_FIXATIVE_LABEL: Record<SurgerySpecimenFixative, string> = {
  formalin_10: 'Formalin 10%',
  segar: 'Segar (tanpa fiksatif)',
  alkohol_95: 'Alkohol 95%',
  lainnya: 'Lainnya',
};

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** Satu spesimen yang dikirim dari kamar operasi. */
export const surgerySpecimenItemSchema = z
  .strictObject({
    /** Asal jaringan/organ + sisi, mis. "Kandung empedu" atau "Kelenjar getah bening aksila kanan". */
    site: text(2, 200),
    examination: z.enum(SURGERY_SPECIMEN_EXAMS),
    containers: z.int().min(1).max(20),
    fixative: z.enum(SURGERY_SPECIMEN_FIXATIVES),
    /** Diagnosis klinis / pertanyaan untuk patolog. */
    clinicalNote: text(5, 1000),
    cito: z.boolean().default(false),
  })
  .refine((s) => s.examination !== 'potong_beku' || s.fixative === 'segar', {
    message: 'Potong beku dikirim segar (tanpa fiksatif)',
    path: ['fixative'],
  });
export type SurgerySpecimenItem = z.infer<typeof surgerySpecimenItemSchema>;

/** `POST surgery/cases/:id/specimens`: satu kiriman (1–10 spesimen) dari laporan operasi terkini. */
export const surgerySpecimenInputSchema = z.strictObject({
  items: z.array(surgerySpecimenItemSchema).min(1).max(10),
});
export type SurgerySpecimenInput = z.infer<typeof surgerySpecimenInputSchema>;

/** Spesimen di kasus (layar OK). `labelNo` = nomor kasus + urutan (mis. `OK-2610-0001-S1`). */
export const surgerySpecimenViewSchema = z.strictObject({
  id: uuid,
  labelNo: z.string(),
  site: z.string(),
  examination: z.enum(SURGERY_SPECIMEN_EXAMS),
  containers: z.int().min(1),
  fixative: z.enum(SURGERY_SPECIMEN_FIXATIVES),
  clinicalNote: z.string(),
  cito: z.boolean(),
  operativeReportId: uuid,
  sentAt: instant,
  sentBy: z.string(),
});
export type SurgerySpecimenView = z.infer<typeof surgerySpecimenViewSchema>;

/** Nama event (didaftarkan di `DOMAIN_EVENT_SCHEMAS`). */
export const SURGERY_SPECIMEN_SENT_EVENT = 'surgery.specimen_sent' as const;

/**
 * Muatan `surgery.specimen_sent` (tanpa isi klinis). Penangan S02 (4.8) membuat order PA dari baris
 * `surgery_specimens` id `surgerySpecimenId` di transaksi yang sama (event domain sinkron).
 */
export const surgerySpecimenSentPayloadSchema = z.strictObject({
  surgerySpecimenId: uuid,
  surgeryCaseId: uuid,
  operativeReportId: uuid,
  encounterId: uuid,
  patientId: uuid,
  /** Unit kunjungan (bukan unit OK), seperti event penunjang lain. */
  unitId: uuid,
  examination: z.enum(SURGERY_SPECIMEN_EXAMS),
  cito: z.boolean(),
});
export type SurgerySpecimenSentPayload = z.infer<typeof surgerySpecimenSentPayloadSchema>;
