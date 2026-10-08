import { z } from 'zod';
import { SIGNATURE_STATUSES } from '../documents';
import { PATIENT_SEXES } from '../patient';
import {
  CHECKLIST_PHASES,
  type COUNT_KINDS,
  operativeReportInputSchema,
  SURGERY_CASE_STATUSES,
  SURGERY_EVENT_KINDS,
  SURGERY_PRIORITIES,
  SURGERY_TEAM_ROLES,
} from './kamar-operasi';
import { clinicalRevisionSchema } from './klinis';
import { surgerySpecimenViewSchema } from './surgery-specimen';

/**
 * S06 · Jawaban API kamar operasi untuk layar mode api (rencana fase 4 §4.7). Kontrak masukan per aksi ada di
 * `kamar-operasi.ts` (4.0a, dibekukan); berkas ini menambah bentuk papan, kasus, dan laporan. Nama pasien lengkap
 * hanya di papan staf berizin `surgery.read` (diaudit per pasien).
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });

export const SURGERY_TEAM_ROLE_LABEL: Record<(typeof SURGERY_TEAM_ROLES)[number], string> = {
  operator: 'Operator',
  asisten: 'Asisten',
  anestesi: 'Dokter anestesi',
  penata_anestesi: 'Penata anestesi',
  perawat_instrumen: 'Perawat instrumen',
  perawat_sirkuler: 'Perawat sirkuler',
};

export const surgeryChecklistViewSchema = z.strictObject({
  phase: z.enum(CHECKLIST_PHASES),
  items: z.array(
    z.strictObject({
      code: z.string(),
      label: z.string(),
      /** Diisi sistem (persetujuan tindakan, hasil hitung), tidak dicentang manual. */
      system: z.boolean(),
      checked: z.boolean(),
      checkedBy: z.string().nullable(),
    }),
  ),
  confirmedAt: instant.nullable(),
  confirmedBy: z.string().nullable(),
});
export type SurgeryChecklistView = z.infer<typeof surgeryChecklistViewSchema>;

/** Satu versi/adendum laporan operasi di layar (isi lengkap untuk prefill koreksi dan adendum). */
export const operativeReportViewSchema = z.strictObject({
  id: uuid,
  version: z.int().min(1),
  recordedAt: instant,
  author: z.string(),
  preOpDiagnosis: z.strictObject({ icd10: z.string(), label: z.string() }),
  postOpDiagnosis: z.strictObject({ icd10: z.string(), label: z.string() }),
  procedureCodes: z.array(z.string()),
  findings: z.string(),
  complications: z.string(),
  bloodLossMl: z.int().min(0),
  implants: z.string(),
  paSpecimen: z.boolean(),
  signatureStatus: z.enum(SIGNATURE_STATUSES).nullable(),
  documentId: uuid.nullable(),
});
export type OperativeReportView = z.infer<typeof operativeReportViewSchema>;

export const surgeryCaseViewSchema = z.strictObject({
  id: uuid,
  caseNo: z.string(),
  encounterId: uuid,
  roomId: uuid,
  startsAt: instant,
  endsAt: instant,
  /** Menit sejak tengah malam WIB tanggal papan (bisa negatif/lebih bila kasus melewati hari). */
  startMin: z.int(),
  durationMin: z.int().min(1),
  status: z.enum(SURGERY_CASE_STATUSES),
  priority: z.enum(SURGERY_PRIORITIES),
  procedureName: z.string(),
  procedureCode: z.string().nullable(),
  patient: z.strictObject({
    id: uuid,
    name: z.string(),
    rm: z.string(),
    sex: z.enum(PATIENT_SEXES),
    ageYears: z.int().min(0).nullable(),
    birthDate: z.iso.date().nullable(),
    allergies: z.array(z.string()),
    guarantor: z.string().nullable(),
  }),
  team: z.array(z.strictObject({ userId: uuid, name: z.string(), role: z.enum(SURGERY_TEAM_ROLES) })),
  /** Persetujuan tindakan final (3.7) yang masih berlaku untuk kunjungan ini; null = belum ada/dicabut. */
  consent: z.strictObject({ id: uuid, procedure: z.string(), decidedAt: instant }).nullable(),
  checklist: z.array(surgeryChecklistViewSchema).length(3),
  events: z.array(
    z.strictObject({
      kind: z.enum(SURGERY_EVENT_KINDS),
      at: instant,
      by: z.string(),
      overrideReason: z.string().nullable(),
    }),
  ),
  counts: z.array(
    z.strictObject({
      itemCode: z.string(),
      label: z.string(),
      /** Awal + tambahan. */
      expected: z.int().min(0),
      final: z.int().min(0).nullable(),
      resolution: z.string().nullable(),
    }),
  ),
  /** Butir hitung yang belum cocok dan belum ditindaklanjuti. */
  unreconciled: z.array(z.string()),
  supplies: z.array(
    z.strictObject({
      id: uuid,
      name: z.string(),
      batchNo: z.string(),
      quantity: z.int(),
      implant: z.boolean(),
    }),
  ),
  /** Laporan operasi terkini (versi terakhir yang tidak digantikan) + adendumnya; null = belum ada. */
  report: operativeReportViewSchema
    .extend({
      /** Alasan koreksi versi ini (null untuk versi 1). */
      correctionReason: z.string().nullable(),
      addenda: z.array(operativeReportViewSchema),
    })
    .nullable(),
  /** Asesmen pra-anestesi dan catatan anestesi (formulir P07) kunjungan kasus. */
  anesthesia: z.strictObject({
    /** Asesmen pra-anestesi final terkini; null = belum ada (sign in tertahan). */
    preAssessment: z
      .strictObject({
        id: uuid,
        version: z.int().min(1),
        recordedAt: instant,
        author: z.string(),
        asa: z.string().nullable(),
      })
      .nullable(),
    records: z.array(
      z.strictObject({ id: uuid, version: z.int().min(1), recordedAt: instant, author: z.string() }),
    ),
  }),
  specimens: z.array(surgerySpecimenViewSchema),
  cancelReason: z.string().nullable(),
});
export type SurgeryCaseView = z.infer<typeof surgeryCaseViewSchema>;

export const surgeryBoardSchema = z.strictObject({
  date: z.iso.date(),
  serverNow: instant,
  dayStartMin: z.int(),
  dayEndMin: z.int(),
  stats: z.strictObject({
    utilizationPercent: z.int().min(0).max(100),
    onTimeStartPercent: z.int().min(0).max(100).nullable(),
    cancellations: z.int().min(0),
  }),
  rooms: z.array(
    z.strictObject({ id: uuid, code: z.string(), name: z.string(), cases: z.array(surgeryCaseViewSchema) }),
  ),
  /** Daftar tunggu: kasus terjadwal 14 hari ke depan (selain tanggal papan). */
  waitlist: z.array(
    z.strictObject({
      id: uuid,
      caseNo: z.string(),
      startsAt: instant,
      roomName: z.string(),
      patientName: z.string(),
      procedureName: z.string(),
      priority: z.enum(SURGERY_PRIORITIES),
    }),
  ),
});
export type SurgeryBoard = z.infer<typeof surgeryBoardSchema>;

/** `POST /surgery/cases/:id/reports`: isian 4.0a + revisi berversi (koreksi beralasan bila TTE gagal). */
export const operativeReportCreateSchema = operativeReportInputSchema.extend({
  revision: clinicalRevisionSchema.default({ kind: 'baru' }),
});
export type OperativeReportCreateInput = z.input<typeof operativeReportCreateSchema>;

/** `GET /surgery/supplies/options`: batch BHP/obat di depo OK dengan saldo > 0 dan belum kedaluwarsa. */
export const surgerySupplyOptionsSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      stockBatchId: uuid,
      name: z.string(),
      batchNo: z.string(),
      expiryDate: z.iso.date(),
      quantity: z.int().min(1),
    }),
  ),
});

/** `GET /surgery/staff`: staf aktif untuk susunan tim (dokter + perawat), tanpa data pribadi lain. */
export const surgeryStaffOptionsSchema = z.strictObject({
  items: z.array(z.strictObject({ userId: uuid, name: z.string(), role: z.string() })),
});

export const COUNT_KIND_LABEL: Record<(typeof COUNT_KINDS)[number], string> = {
  awal: 'Hitung awal',
  tambahan: 'Tambahan',
  akhir: 'Hitung akhir',
};

/**
 * `GET /surgery/candidates?q=`: kunjungan aktif (rawat inap, IGD, rawat jalan) untuk dijadwalkan operasi, dicari dengan
 * No. RM atau nomor kunjungan (min. 3 karakter). Hanya nama + RM + nomor; diaudit per pasien.
 */
export const surgeryCandidatesSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      encounterId: uuid,
      number: z.string(),
      encounterClass: z.string(),
      patientName: z.string(),
      rm: z.string(),
    }),
  ),
});
export type SurgeryCandidate = z.infer<typeof surgeryCandidatesSchema>['items'][number];

/**
 * Aliran SSE aktivitas papan OK (4.7b): setiap baris baru di tabel kasus (status, butir tilik, konfirmasi fase,
 * peristiwa, hitung, tindak lanjut, BHP, laporan, spesimen, formulir anestesi) memicu `pg_notify` kanal
 * `support_surgery_activity`. Muatan hanya ID (tanpa nama/isi klinis); layar memuat ulang papan yang diaudit.
 * Kanal 4.1a `surgery.board` (riwayat status) tetap seperti adanya untuk pemakai lain.
 */
export const SURGERY_ACTIVITY_NOTIFY_CHANNEL = 'support_surgery_activity';
export const SURGERY_ACTIVITY_SSE_EVENT = 'surgery.activity';
export const SURGERY_ACTIVITY_SOURCES = [
  'status',
  'check',
  'confirmation',
  'event',
  'count',
  'discrepancy',
  'supply',
  'report',
  'specimen',
  'anesthesia_form',
] as const;
export type SurgeryActivitySource = (typeof SURGERY_ACTIVITY_SOURCES)[number];
export interface SurgeryActivitySseEvent {
  /** Id baris sumber (baris append-only baru → id unik per perubahan). */
  eventId: string;
  source: SurgeryActivitySource;
  surgeryCaseId: string;
  encounterId: string;
  /** Unit kamar operasi (unit lokasi kamar). */
  unitId: string;
  /** Tanggal WIB jadwal mulai (`YYYY-MM-DD`). */
  date: string;
}
