import { z } from 'zod';
import { BLOOD_ABO_RULES } from '../rules/blood';
import { SAFETY_REASON_MIN } from './klinis';
import {
  ABO_GROUPS,
  BLOOD_UNIT_STATUSES,
  BLOOD_URGENCIES,
  CROSSMATCH_RESULTS,
  DIET_TEXTURES,
  MEAL_LEFTOVERS,
  MEALS,
  RH_FACTORS,
} from './penunjang-api';

/**
 * S07 Gizi + S08 Bank darah · kontrak API potongan 4.9 (ADR-0105). Masukan dasar (`dietOrderInputSchema`,
 * `mealServiceInputSchema`, `bloodRequestInputSchema`, `crossmatchInputSchema`, `transfusionReactionInputSchema`) ada di
 * `penunjang-api.ts` (4.0a); di sini masukan gerbang baru (cek ganda dua petugas, transfusi gelang ↔ kantong) dan
 * rekaman jawaban API. Penulis, waktu catat, status, dan hasil gerbang selalu dari server.
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const reason = z.string().trim().min(SAFETY_REASON_MIN).max(500);
const person = z.strictObject({ id: uuid, name: z.string() });
const scanCode = text(1, 64);

/** Pasien ringkas di layar penunjang (dua pengenal: nama + No. RM, tanggal lahir). */
export const supportPatientLiteSchema = z.strictObject({
  id: uuid,
  name: z.string(),
  mrn: z.string(),
  sex: z.enum(['male', 'female', 'unknown']),
  birthDate: isoDate.nullable(),
  /** Unit tempat pasien kini (unit bed, atau unit kunjungan). */
  unitName: z.string().nullable(),
  bed: z.string().nullable(),
});
export type SupportPatientLite = z.infer<typeof supportPatientLiteSchema>;

/**
 * Tampilan penunjang: `layanan` = unit pelaksana (bank darah/instalasi gizi) melihat semua order aktif + 7 hari
 * (keputusan fase 4 no. 3); `ruangan` = klinisi melihat pasien yang boleh dibukanya (ABAC fase 3).
 */
export const SUPPORT_VIEWS = ['layanan', 'ruangan'] as const;
export type SupportView = (typeof SUPPORT_VIEWS)[number];

// ═════════════════════════════ S07 · Gizi ═════════════════════════════

export const MEAL_LABEL: Record<(typeof MEALS)[number], string> = {
  pagi: 'Makan pagi',
  selingan_pagi: 'Selingan pagi',
  siang: 'Makan siang',
  selingan_sore: 'Selingan sore',
  malam: 'Makan malam',
};
export const TEXTURE_LABEL: Record<(typeof DIET_TEXTURES)[number], string> = {
  biasa: 'Biasa',
  lunak: 'Lunak',
  saring: 'Saring',
  cair: 'Cair',
  sonde: 'Sonde (NGT)',
};
export const LEFTOVER_LABEL: Record<(typeof MEAL_LEFTOVERS)[number], string> = {
  habis: 'Habis',
  sisa_seperempat: 'Sisa ¼',
  sisa_setengah: 'Sisa ½',
  utuh: 'Utuh (tidak dimakan)',
};

export const dietTypeOptionSchema = z.strictObject({ id: uuid, code: z.string(), name: z.string() });
export type DietTypeOption = z.infer<typeof dietTypeOptionSchema>;

export const dietOrderRecordSchema = z.strictObject({
  id: uuid,
  encounterId: uuid,
  patientId: uuid,
  dietType: dietTypeOptionSchema,
  texture: z.enum(DIET_TEXTURES),
  notes: z.string().nullable(),
  startsOn: isoDate,
  status: z.enum(['aktif', 'selesai']),
  endedAt: instant.nullable(),
  orderedBy: person,
  orderedAt: instant,
});
export type DietOrderRecord = z.infer<typeof dietOrderRecordSchema>;

export const mealListQuerySchema = z.strictObject({
  date: isoDate,
  meal: z.enum(MEALS),
  unitId: uuid.optional(),
});
export type MealListQuery = z.infer<typeof mealListQuerySchema>;

export const mealServiceRecordSchema = z.strictObject({
  id: uuid,
  dietOrderId: uuid,
  meal: z.enum(MEALS),
  servedAt: instant,
  leftover: z.enum(MEAL_LEFTOVERS).nullable(),
  recordedBy: person,
  recordedAt: instant,
});
export type MealServiceRecord = z.infer<typeof mealServiceRecordSchema>;

/** Satu baris daftar makan (per bangsal × jam makan) = satu label makanan. */
export const mealListRowSchema = z.strictObject({
  dietOrderId: uuid,
  encounterId: uuid,
  patient: supportPatientLiteSchema,
  unitId: uuid.nullable(),
  dietType: dietTypeOptionSchema,
  texture: z.enum(DIET_TEXTURES),
  notes: z.string().nullable(),
  /** Alergi tercatat (obat dan makanan) untuk dapur; label menampilkannya. */
  allergies: z.array(z.string()),
  /** Layanan makan terakhir untuk jam makan + tanggal ini (null = belum diantar). */
  service: mealServiceRecordSchema.nullable(),
});
export type MealListRow = z.infer<typeof mealListRowSchema>;

export const mealListSchema = z.strictObject({
  serverNow: instant,
  view: z.enum(SUPPORT_VIEWS),
  date: isoDate,
  meal: z.enum(MEALS),
  units: z.array(z.strictObject({ id: uuid, name: z.string(), count: z.int().min(0) })),
  rows: z.array(mealListRowSchema),
});
export type MealList = z.infer<typeof mealListSchema>;

// ═════════════════════════════ S08 · Bank darah ═════════════════════════════

export const ABO_RH_LABEL = (abo: (typeof ABO_GROUPS)[number], rh: (typeof RH_FACTORS)[number]): string =>
  `${abo} Rh${rh === 'pos' ? '+' : '−'}`;

export const bloodComponentOptionSchema = z.strictObject({
  id: uuid,
  code: z.string(),
  name: z.string(),
  aboRule: z.enum(BLOOD_ABO_RULES),
});
export type BloodComponentOption = z.infer<typeof bloodComponentOptionSchema>;

export const bloodUnitInputSchema = z.strictObject({
  bagNo: text(3, 40),
  componentCode: text(1, 20),
  abo: z.enum(ABO_GROUPS),
  rh: z.enum(RH_FACTORS),
  collectedAt: instant,
  expiresAt: instant,
});
export type BloodUnitInput = z.infer<typeof bloodUnitInputSchema>;

export const bloodUnitRecordSchema = z.strictObject({
  id: uuid,
  bagNo: z.string(),
  component: bloodComponentOptionSchema,
  abo: z.enum(ABO_GROUPS),
  rh: z.enum(RH_FACTORS),
  collectedAt: instant,
  expiresAt: instant,
  status: z.enum(BLOOD_UNIT_STATUSES),
  /** Lewat ED menurut jam server (status `tersedia` bisa saja sudah kedaluwarsa). */
  expired: z.boolean(),
});
export type BloodUnitRecord = z.infer<typeof bloodUnitRecordSchema>;

export const bloodGroupInputSchema = z.strictObject({ abo: z.enum(ABO_GROUPS), rh: z.enum(RH_FACTORS) });
export type BloodGroupInput = z.infer<typeof bloodGroupInputSchema>;

/** Cek ganda PERTAMA: lima butir wajib `true` (CHECK database). */
export const bloodIssueCheckInputSchema = z.strictObject({
  bloodRequestId: uuid,
  bloodUnitId: uuid,
  checklist: z.strictObject({
    identitas: z.literal(true),
    nomor: z.literal(true),
    golongan: z.literal(true),
    kedaluwarsa: z.literal(true),
    kantong_utuh: z.literal(true),
  }),
  /** Jalur darurat tanpa crossmatch: alasan dokter (keputusan fase 4 no. 22). */
  emergencyReason: reason.nullable(),
});
export type BloodIssueCheckInput = z.infer<typeof bloodIssueCheckInputSchema>;

/** Pengeluaran oleh petugas KEDUA dari sesinya sendiri atas cek ganda pertama rekannya. */
export const bloodIssueConfirmInputSchema = z.strictObject({ issueCheckId: uuid });
export type BloodIssueConfirmInput = z.infer<typeof bloodIssueConfirmInputSchema>;

export const transfusionVitalsInputSchema = z.strictObject({
  label: z.enum(['awal', '15_menit', '1_jam', 'selesai', 'lain']),
  tempC: z.number().min(30).max(45),
  systolic: z.int().min(30).max(300),
  diastolic: z.int().min(10).max(200),
  pulse: z.int().min(20).max(250),
  signs: z.array(text(1, 60)).max(10),
});
export type TransfusionVitalsInput = z.infer<typeof transfusionVitalsInputSchema>;

export const TRANSFUSION_VITAL_LABEL: Record<TransfusionVitalsInput['label'], string> = {
  awal: 'Sebelum mulai',
  '15_menit': '15 menit',
  '1_jam': '1 jam',
  selesai: 'Selesai',
  lain: 'Tambahan',
};

/** Pemasang: pindai gelang + nomor kantong, TTV awal. Transfusi menunggu verifikasi petugas kedua. */
export const transfusionStartInputSchema = z.strictObject({
  bloodIssueId: uuid,
  wristbandCode: scanCode,
  bagNo: scanCode,
  baseline: transfusionVitalsInputSchema.omit({ label: true, signs: true }),
});
export type TransfusionStartInput = z.infer<typeof transfusionStartInputSchema>;

/** Petugas kedua (bukan pemasang) memindai ulang gelang + kantong dari sesinya sendiri. */
export const transfusionVerifyInputSchema = z.strictObject({ wristbandCode: scanCode, bagNo: scanCode });
export type TransfusionVerifyInput = z.infer<typeof transfusionVerifyInputSchema>;

export const transfusionVitalRecordSchema = z.strictObject({
  id: uuid,
  label: transfusionVitalsInputSchema.shape.label,
  tempC: z.number(),
  systolic: z.int(),
  diastolic: z.int(),
  pulse: z.int(),
  signs: z.array(z.string()),
  recordedBy: person,
  recordedAt: instant,
});
export type TransfusionVitalRecord = z.infer<typeof transfusionVitalRecordSchema>;

export const TRANSFUSION_STATUSES = ['menunggu_verifikasi', 'berjalan', 'selesai', 'dihentikan'] as const;

export const transfusionRecordSchema = z.strictObject({
  id: uuid,
  bloodIssueId: uuid,
  status: z.enum(TRANSFUSION_STATUSES),
  startedBy: person,
  startedAt: instant,
  verifiedBy: person.nullable(),
  verifiedAt: instant.nullable(),
  endedAt: instant.nullable(),
  stopReason: z.string().nullable(),
  vitals: z.array(transfusionVitalRecordSchema),
});
export type TransfusionRecord = z.infer<typeof transfusionRecordSchema>;

/** Hasil pencatatan TTV: dugaan reaksi menghentikan transfusi di transaksi yang sama. */
export const transfusionVitalsResultSchema = z.strictObject({
  transfusion: transfusionRecordSchema,
  reaction: z.boolean(),
  reasons: z.array(z.string()),
});
export type TransfusionVitalsResult = z.infer<typeof transfusionVitalsResultSchema>;

export const transfusionReactionRecordSchema = z.strictObject({
  id: uuid,
  occurredAt: instant,
  severity: z.enum(['ringan', 'sedang', 'berat']),
  description: z.string(),
  reportedBy: person,
  reportedAt: instant,
});
export type TransfusionReactionRecord = z.infer<typeof transfusionReactionRecordSchema>;

export const crossmatchRecordSchema = z.strictObject({
  id: uuid,
  bloodUnitId: uuid,
  bagNo: z.string(),
  result: z.enum(CROSSMATCH_RESULTS),
  method: z.string(),
  testedBy: person,
  testedAt: instant,
});
export type CrossmatchRecord = z.infer<typeof crossmatchRecordSchema>;

export const bloodIssueCheckRecordSchema = z.strictObject({
  id: uuid,
  bloodUnitId: uuid,
  bagNo: z.string(),
  checkedBy: person,
  checkedAt: instant,
  emergencyReason: z.string().nullable(),
  /** Sudah dipakai pengeluaran. */
  used: z.boolean(),
  /** Lewat `BLOOD_ISSUE_CHECK_VALID_MINUTES` (harus diulang). */
  expired: z.boolean(),
});
export type BloodIssueCheckRecord = z.infer<typeof bloodIssueCheckRecordSchema>;

export const bloodIssueRecordSchema = z.strictObject({
  id: uuid,
  bloodUnitId: uuid,
  bagNo: z.string(),
  abo: z.enum(ABO_GROUPS),
  rh: z.enum(RH_FACTORS),
  expiresAt: instant,
  checkedBy: person.nullable(),
  issuedBy: person,
  issuedAt: instant,
  emergencyReason: z.string().nullable(),
  transfusion: transfusionRecordSchema.nullable(),
  reactions: z.array(transfusionReactionRecordSchema),
});
export type BloodIssueRecord = z.infer<typeof bloodIssueRecordSchema>;

export const bloodRequestRecordSchema = z.strictObject({
  id: uuid,
  requestNo: z.string(),
  encounterId: uuid,
  patient: supportPatientLiteSchema,
  component: bloodComponentOptionSchema,
  units: z.int().min(1),
  urgency: z.enum(BLOOD_URGENCIES),
  indication: z.string(),
  patientAbo: z.enum(ABO_GROUPS).nullable(),
  patientRh: z.enum(RH_FACTORS).nullable(),
  status: z.enum(['diminta', 'diproses', 'selesai', 'batal']),
  requestedBy: person,
  requestedAt: instant,
  crossmatches: z.array(crossmatchRecordSchema),
  issueChecks: z.array(bloodIssueCheckRecordSchema),
  issues: z.array(bloodIssueRecordSchema),
});
export type BloodRequestRecord = z.infer<typeof bloodRequestRecordSchema>;

export const bloodBoardSchema = z.strictObject({
  serverNow: instant,
  view: z.enum(SUPPORT_VIEWS),
  requests: z.array(bloodRequestRecordSchema),
  /** Stok kantong (tampilan layanan saja; tampilan ruangan kosong). */
  units: z.array(bloodUnitRecordSchema),
  components: z.array(bloodComponentOptionSchema),
});
export type BloodBoard = z.infer<typeof bloodBoardSchema>;

export const bloodBoardQuerySchema = z.strictObject({
  /** `aktif` = diminta/diproses + selesai/batal ≤ 7 hari; `kunjungan` = semua permintaan kunjungan ini. */
  encounterId: uuid.optional(),
});
export type BloodBoardQuery = z.infer<typeof bloodBoardQuerySchema>;

export const transfusionStopInputSchema = z.strictObject({ reason: reason });
export type TransfusionStopInput = z.infer<typeof transfusionStopInputSchema>;
