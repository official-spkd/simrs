import type { SurgeryCaseStatus } from './schemas/kamar-operasi';
import type { CriticalStatus, LabOrderStatus, PrescriptionStatus } from './schemas/penunjang-api';

/**
 * Fase 4 §4.1a · Kanal SSE penunjang (ADR-0026). Trigger database mengirim `pg_notify(<kanal>, { tenant_id, id })` saat
 * baris riwayat status ditulis; API membaca baris itu di transaksi pendek tenant pelanggan (RLS) lalu menyaring per
 * lingkup izin. Muatan hanya ID + kode status + waktu (tanpa nama, nilai, atau diagnosis): layar memuat ulang detail
 * lewat endpoint berizin yang diaudit.
 */
export const SUPPORT_NOTIFY_CHANNELS = {
  /** `lab_order_status_history` → worklist unit lab (`lab.worklist:<unit>`). */
  labWorklist: 'support_lab_worklist',
  /** `pharmacy_prescription_status_history` → antrean depo (`pharmacy.queue:<unit>`). */
  pharmacyQueue: 'support_pharmacy_queue',
  /** `surgery_case_status_history` → papan OK per tanggal (`surgery.board:<tanggal>`). */
  surgeryBoard: 'support_surgery_board',
  /** `critical_results`, `critical_result_reports`, `critical_result_escalations` → `critical:<pengguna>`. */
  critical: 'support_critical',
} as const;

/** Nama event SSE (`event:`). */
export const SUPPORT_SSE_EVENTS = {
  labWorklist: 'lab.worklist',
  pharmacyQueue: 'pharmacy.queue',
  surgeryBoard: 'surgery.board',
  critical: 'critical.result',
} as const;

/** Rute aliran SSE penunjang (prefiks `/api/v1`). */
export const SUPPORT_STREAM_PATHS = {
  labWorklist: '/support/streams/lab-worklist',
  pharmacyQueue: '/support/streams/pharmacy-queue',
  surgeryBoard: '/support/streams/surgery-board',
  critical: '/support/streams/critical',
} as const;

export interface LabWorklistSseEvent {
  /** Id baris riwayat status (stabil, untuk `Last-Event-ID`). */
  eventId: string;
  labOrderId: string;
  /** Unit lab pelaksana order. */
  unitId: string;
  status: LabOrderStatus;
  at: string;
}

export interface PharmacyQueueSseEvent {
  eventId: string;
  prescriptionId: string;
  stockLocationId: string;
  /** Unit depo (lokasi stok) yang melayani resep. */
  unitId: string;
  status: PrescriptionStatus;
  at: string;
}

export interface SurgeryBoardSseEvent {
  eventId: string;
  surgeryCaseId: string;
  encounterId: string;
  roomId: string;
  /** Unit kamar operasi (unit lokasi kamar). */
  unitId: string;
  /** Tanggal WIB jadwal mulai (`YYYY-MM-DD`): papan OK per hari. */
  date: string;
  status: SurgeryCaseStatus;
  at: string;
}

export type CriticalSseKind = 'raised' | 'reported' | 'escalated';

export interface CriticalResultSseEvent {
  eventId: string;
  kind: CriticalSseKind;
  criticalResultId: string;
  encounterId: string;
  /** Unit pelapor (lab/radiologi). */
  unitId: string;
  status: CriticalStatus;
  /** Tingkat eskalasi (0 = belum dieskalasi). */
  level: number;
  /** Penerima notifikasi eskalasi (hanya untuk `escalated`). */
  notifiedUserIds: string[];
  at: string;
}
