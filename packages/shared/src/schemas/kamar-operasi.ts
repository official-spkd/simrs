import { z } from 'zod';
import { SURGERY_PRIORITIES } from './penunjang-api';

/**
 * S06 · Kamar operasi. Bagian pertama = kontrak layar mode presentasi (dipindah dari `btn.ts`, rencana fase 4 §4.0a;
 * `btn.ts` me-re-export sementara). Bagian kedua = kontrak API fase 4 (token status = CHECK database 4.0b, skema
 * masukan per aksi). Urutan daftar tilik WHO, kelengkapan butir, dan gerbang insisi dijaga juga trigger database.
 */

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const count = z.number().int().min(0);

export const OR_CASE_STATUSES = ['selesai', 'berjalan', 'terjadwal', 'cito'] as const;
export type OrCaseStatus = (typeof OR_CASE_STATUSES)[number];

export const CHECKLIST_PHASES = ['sign-in', 'time-out', 'sign-out'] as const;
export type ChecklistPhaseId = (typeof CHECKLIST_PHASES)[number];

/** Butir daftar tilik keselamatan operasi WHO. */
export const checklistItemSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  checked: z.boolean(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistPhaseSchema = z.strictObject({
  phase: z.enum(CHECKLIST_PHASES),
  items: z.array(checklistItemSchema).length(5),
  confirmedAt: isoDateTime.nullable(),
  confirmedBy: z.string().min(1).nullable(),
});
export type ChecklistPhase = z.infer<typeof checklistPhaseSchema>;

/** Hitung kasa, jarum, dan instrumen: hitung awal (sebelum insisi) dan akhir (saat sign out). */
export const instrumentCountSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  unit: z.string().min(1),
  initial: z.number().int().min(0),
  final: z.number().int().min(0).nullable(),
});
export type InstrumentCount = z.infer<typeof instrumentCountSchema>;

export const orCaseSchema = z.strictObject({
  id: z.string().min(1),
  /** Menit sejak tengah malam (WIB). */
  startMin: z.number().int().min(0).max(1440),
  durationMin: z.number().int().min(15).max(720),
  status: z.enum(OR_CASE_STATUSES),
  /** Keterangan singkat di blok jadwal, mis. "selesai 08.34". */
  statusNote: z.string(),
  patient: z.strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
    rm: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
    sex: z.enum(['L', 'P']),
    ageYears: z.number().int().min(0),
    birthDate: isoDate,
    allergies: z.array(z.string().min(1)),
    guarantor: z.string().min(1),
  }),
  procedure: z.string().min(1),
  /** ICD-9-CM (hanya kode seed); null = dikode setelah laporan operasi. */
  icd9cm: z
    .string()
    .regex(/^\d{2}\.\d{1,2}$/)
    .nullable(),
  diagnosis: z.strictObject({ icd10: z.string().min(3), label: z.string().min(1) }).nullable(),
  operator: z.string().min(1),
  anesthetist: z.string().min(1),
  anesthesia: z.string().min(1),
  nurses: z.strictObject({ scrub: z.string().min(1), circulating: z.string().min(1) }),
  checklist: z.array(checklistPhaseSchema).length(3),
  counts: z.array(instrumentCountSchema).min(1),
  incisionAt: isoDateTime.nullable(),
  scenario: z.boolean(),
  /**
   * Tanggal kasus pasien skenario pada garis waktu Simulasi (bisa berbeda dari hari jadwal); null = bukan pasien
   * skenario atau langkah operasi skenario belum dimulai.
   */
  scenarioDate: isoDate.nullable(),
});
export type OrCase = z.infer<typeof orCaseSchema>;

export const orRoomSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  cases: z.array(orCaseSchema),
});
export type OrRoom = z.infer<typeof orRoomSchema>;

export const orScheduleSchema = z.strictObject({
  date: isoDate,
  now: isoDateTime,
  /** Rentang jadwal (menit sejak tengah malam), mis. 07.00–16.00. */
  dayStartMin: z.number().int().min(0).max(1440),
  dayEndMin: z.number().int().min(0).max(1440),
  stats: z.strictObject({
    utilizationPercent: z.number().int().min(0).max(100),
    onTimeStartPercent: z.number().int().min(0).max(100),
    cancellations: count,
  }),
  rooms: z.array(orRoomSchema).length(4),
});
export type OrSchedule = z.infer<typeof orScheduleSchema>;

// ═════════════════════════════ Kontrak API fase 4 ═════════════════════════════

const uuid = z.uuid();
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** Status kasus (DB `surgery_cases.status`). */
export const SURGERY_CASE_STATUSES = ['terjadwal', 'persiapan', 'berjalan', 'selesai', 'batal'] as const;
export type SurgeryCaseStatus = (typeof SURGERY_CASE_STATUSES)[number];
export { SURGERY_PRIORITIES };
/** Peristiwa intraoperatif, masing-masing sekali per kasus. */
export const SURGERY_EVENT_KINDS = ['induksi', 'insisi', 'tutup', 'keluar'] as const;
export type SurgeryEventKind = (typeof SURGERY_EVENT_KINDS)[number];
export const SURGERY_TEAM_ROLES = [
  'operator',
  'asisten',
  'anestesi',
  'penata_anestesi',
  'perawat_instrumen',
  'perawat_sirkuler',
] as const;
export const COUNT_KINDS = ['awal', 'tambahan', 'akhir'] as const;
/** Panjang minimum alasan override insisi sebelum time out (bawaan pengaturan `surgery.override_reason_min`). */
export const SURGERY_OVERRIDE_REASON_MIN = 15;
/** Butir yang diisi sistem dari persetujuan tindakan bertanda tangan (F3-6); tidak bisa dicentang manual. */
export const CONSENT_CHECKLIST_ITEM = 'sign-in-consent';

/** `POST /api/v1/surgery/cases`: jadwal kamar (tumpang tindih kasus aktif → 409 `ROOM_OVERLAP`, EXCLUDE di DB). */
export const surgeryCaseInputSchema = z
  .strictObject({
    encounterId: uuid,
    roomId: uuid,
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    priority: z.enum(SURGERY_PRIORITIES),
    procedureName: text(3, 200),
    procedureCode: z
      .string()
      .regex(/^\d{2}(\.\d{1,2})?$/)
      .nullable(),
    team: z
      .array(z.strictObject({ userId: uuid, role: z.enum(SURGERY_TEAM_ROLES) }))
      .min(1)
      .max(12),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    path: ['endsAt'],
    message: 'Jam selesai harus setelah jam mulai.',
  });
export type SurgeryCaseInput = z.infer<typeof surgeryCaseInputSchema>;

export const surgeryCancelInputSchema = z.strictObject({ reason: text(10, 500) });

/** `POST .../checklist/items`: centang satu butir fase aktif (butir persetujuan diisi sistem). */
export const checklistItemInputSchema = z.strictObject({
  phase: z.enum(CHECKLIST_PHASES),
  itemCode: text(1, 40),
});

/** `POST .../checklist/confirm`: 409 `CHECKLIST_INCOMPLETE` / `CHECKLIST_ORDER`. */
export const checklistConfirmInputSchema = z.strictObject({ phase: z.enum(CHECKLIST_PHASES) });

/** `POST .../events`: insisi sebelum time out hanya dengan override dokter beralasan (≥ 15 karakter). */
export const surgeryEventInputSchema = z.strictObject({
  kind: z.enum(SURGERY_EVENT_KINDS),
  occurredAt: isoDateTime,
  overrideReason: z.string().trim().min(SURGERY_OVERRIDE_REASON_MIN).max(500).nullable(),
});
export type SurgeryEventInput = z.infer<typeof surgeryEventInputSchema>;

/** `POST .../counts`: hitung awal/tambahan/akhir per butir (kasa, jarum, instrumen). */
export const surgicalCountInputSchema = z.strictObject({
  kind: z.enum(COUNT_KINDS),
  items: z
    .array(z.strictObject({ itemCode: text(1, 40), label: text(1, 80), quantity: z.int().min(0).max(1000) }))
    .min(1)
    .max(50),
});
export type SurgicalCountInput = z.infer<typeof surgicalCountInputSchema>;

/** Tindak lanjut selisih hitung (mis. rontgen intraoperatif) sebelum sign out. */
export const countDiscrepancyInputSchema = z.strictObject({
  itemCode: text(1, 40),
  action: text(10, 1000),
});

/** `POST .../supplies`: BHP/implan dari depo OK (ledger `usage`). */
export const surgerySupplyInputSchema = z.strictObject({
  items: z
    .array(z.strictObject({ stockBatchId: uuid, quantity: z.int().positive(), implant: z.boolean() }))
    .min(1),
});

/** `POST .../reports`: laporan operasi (append-only, TTE operator). Spesimen PA → order S02. */
export const operativeReportInputSchema = z.strictObject({
  preOpDiagnosis: z.strictObject({ icd10: z.string().min(3), label: text(1, 200) }),
  postOpDiagnosis: z.strictObject({ icd10: z.string().min(3), label: text(1, 200) }),
  procedureCodes: z
    .array(z.string().regex(/^\d{2}(\.\d{1,2})?$/))
    .min(1)
    .max(10),
  findings: text(5, 8000),
  complications: z.string().trim().max(2000),
  bloodLossMl: z.int().min(0).max(20_000),
  implants: z.string().trim().max(1000),
  paSpecimen: z.boolean(),
});
export type OperativeReportInput = z.infer<typeof operativeReportInputSchema>;

export const surgeryCaseRecordSchema = z.strictObject({
  id: uuid,
  caseNo: z.string().regex(/^OK-\d{4}-\d{4}$/),
  encounterId: uuid,
  roomId: uuid,
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  status: z.enum(SURGERY_CASE_STATUSES),
  priority: z.enum(SURGERY_PRIORITIES),
  procedureName: z.string(),
  procedureCode: z.string().nullable(),
  consentId: uuid.nullable(),
  checklistTemplateVersion: z.int().min(1),
  confirmedPhases: z.array(z.enum(CHECKLIST_PHASES)),
  events: z.array(
    z.strictObject({ kind: z.enum(SURGERY_EVENT_KINDS), at: isoDateTime, override: z.boolean() }),
  ),
});
export type SurgeryCaseRecord = z.infer<typeof surgeryCaseRecordSchema>;
