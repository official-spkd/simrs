import { z } from 'zod';
import { EWS_RISK_LEVELS } from '../clinical/ews';
import { MEDICATION_ADMINISTRATION_STATUSES } from '../clinical/emar';
import { allergyBannerSchema } from './clinical-records';
import { clinicalAuthorSchema } from './klinis';

/**
 * K04/K12 · Kontrak jawaban API layar Rawat inap mode api (fase 3 layar W4): daftar pasien rawat inap per unit/bed
 * (disaring ABAC), pindaian gelang aktif dan atestasi cek ganda per kunjungan (alur dua sesi perawat untuk obat
 * kewaspadaan tinggi, ADR-0077), master diagnosis keperawatan, dan balans cairan harian. Bentuk mengikuti toko demo
 * (`InpatientSummary`) seperlunya; nama pasien hanya untuk staf yang lolos ABAC, setiap pasien yang tampil diaudit.
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();

// ---------------------------------------------------------------------------------------------------------------
// Daftar pasien rawat inap
// ---------------------------------------------------------------------------------------------------------------

/** `GET /api/v1/inpatients?unitId=` · saringan unit opsional (unit bed yang ditempati). */
export const inpatientCensusQuerySchema = z.strictObject({ unitId: uuid.optional() });
export type InpatientCensusQuery = z.infer<typeof inpatientCensusQuerySchema>;

export const inpatientCensusItemSchema = z.strictObject({
  encounterId: uuid,
  encounterNumber: z.string(),
  patientId: uuid,
  name: z.string().min(1),
  mrn: z.string().min(1),
  sex: z.enum(['male', 'female', 'unknown']),
  ageYears: z.int().min(0).nullable(),
  /** Unit tempat pasien kini (unit bed, atau unit kunjungan bila belum ber-bed). */
  unit: z.strictObject({ id: uuid, code: z.string(), name: z.string() }),
  bed: z.strictObject({ id: uuid, code: z.string(), name: z.string() }).nullable(),
  /** DPJP utama tim perawatan, atau DPJP kunjungan. */
  dpjp: z.string().nullable(),
  primaryDiagnosis: z.strictObject({ code: z.string(), display: z.string() }).nullable(),
  admittedOn: isoDate.nullable(),
  /** Hari rawat ke-n (hari masuk = 1, tanggal WIB). */
  day: z.int().min(1),
  ews: z
    .strictObject({
      score: z.int().min(0).max(20),
      maxParam: z.int().min(0).max(3),
      risk: z.enum(EWS_RISK_LEVELS),
      at: instant,
      escalated: z.boolean(),
    })
    .nullable(),
  allergy: allergyBannerSchema,
  /** Catatan residen menunggu co-sign DPJP. */
  pendingCosign: z.int().min(0),
  /** Dosis terjadwal hari ini yang lewat batas terlambat tanpa catatan pemberian. */
  lateDoses: z.int().min(0),
  confidential: z.boolean(),
});
export type InpatientCensusItem = z.infer<typeof inpatientCensusItemSchema>;

export const inpatientCensusSchema = z.strictObject({
  generatedAt: instant,
  /** Unit rawat inap yang terlihat pelaku (untuk saringan), dengan jumlah pasien yang tampil. */
  units: z.array(z.strictObject({ id: uuid, code: z.string(), name: z.string(), count: z.int().min(0) })),
  items: z.array(inpatientCensusItemSchema),
});
export type InpatientCensus = z.infer<typeof inpatientCensusSchema>;

// ---------------------------------------------------------------------------------------------------------------
// eMAR · pindaian gelang aktif + atestasi cek ganda (alur dua sesi, ADR-0077)
// ---------------------------------------------------------------------------------------------------------------

/** `GET /api/v1/nursing/wristband-scans?encounterId=` · pindaian cocok yang masih berlaku (gelang aktif). */
export const nursingEncounterQuerySchema = z.strictObject({ encounterId: uuid });

export const activeWristbandScanSchema = z.strictObject({
  id: uuid,
  by: clinicalAuthorSchema.omit({ peran: true }),
  scannedAt: instant,
  /** Batas berlaku (`emar.scan_valid_minutes`). */
  validUntil: instant,
});
export type ActiveWristbandScan = z.infer<typeof activeWristbandScanSchema>;

/** `GET /api/v1/nursing/double-checks?encounterId=` · atestasi cek ganda atas pindaian yang masih berlaku. */
export const doubleCheckViewSchema = z.strictObject({
  id: uuid,
  scanId: uuid,
  medicationRequestId: uuid,
  scheduleId: uuid.nullable(),
  labelCode: z.string(),
  status: z.enum(MEDICATION_ADMINISTRATION_STATUSES),
  /** Waktu dosis yang diperiksa (dinormalisasi server); pemberian wajib memakai waktu yang sama. */
  occurredAt: instant,
  reason: z.string().nullable(),
  checkedBy: clinicalAuthorSchema,
  checkedAt: instant,
  /** Sudah dipakai sebuah pemberian. */
  used: z.boolean(),
});
export type DoubleCheckView = z.infer<typeof doubleCheckViewSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Askep · master diagnosis keperawatan + balans cairan
// ---------------------------------------------------------------------------------------------------------------

export const nursingDiagnosisOptionSchema = z.strictObject({ id: uuid, code: z.string(), name: z.string() });
export type NursingDiagnosisOption = z.infer<typeof nursingDiagnosisOptionSchema>;

export const fluidBalanceDaySchema = z.strictObject({
  encounterId: uuid,
  date: isoDate,
  entries: z.array(
    z.object({
      id: uuid,
      occurredAt: instant,
      direction: z.enum(['intake', 'output']),
      route: z.string(),
      volumeMl: z.number(),
      note: z.string().nullable(),
      author: clinicalAuthorSchema,
    }),
  ),
  intakeMl: z.number(),
  outputMl: z.number(),
  balanceMl: z.number(),
});
export type FluidBalanceDay = z.infer<typeof fluidBalanceDaySchema>;
