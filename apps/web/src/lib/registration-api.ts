import {
  type BpjsSyncStatus,
  type BpjsQueueTask,
  type BpjsVisitKind,
  type Icd10Coding,
  ICD10_PATTERN,
  IDENTIFIER_SYSTEM_CODES,
  IDENTIFIER_VERIFICATION,
  PATIENT_SEXES,
  PATIENT_STATUSES,
  PRIVACY_CONSENT_KINDS,
  type Referral,
  type Sep,
} from '@simrs/shared';
import type { ChipTone, IconName } from '@simrs/ui';
import { z } from 'zod';

/**
 * F03/F06 · Model dan aturan tampilan layar Pendaftaran mode api (fase 2 potongan 5b), murni (tanpa I/O) agar bisa
 * diuji unit dan dipakai server maupun klien. Bentuk respons MPI/persetujuan yang diterima web divalidasi di sini (BFF,
 * ADR-0013): respons di luar bentuk ini ditolak.
 */

// ---------------------------------------------------------------------------------------------------------------
// Bentuk respons API MPI (P05) dan persetujuan privasi
// ---------------------------------------------------------------------------------------------------------------

const identifierViewSchema = z.object({
  system: z.enum(IDENTIFIER_SYSTEM_CODES),
  masked: z.string(),
  verification: z.enum(IDENTIFIER_VERIFICATION),
  verifiedAt: z.string().nullable(),
});

export const patientSummarySchema = z.object({
  id: z.uuid(),
  mrn: z.string(),
  name: z.string(),
  sex: z.enum(PATIENT_SEXES),
  birthDate: z.string().nullable(),
  birthDateEstimated: z.boolean(),
  unidentified: z.boolean(),
  status: z.enum(PATIENT_STATUSES),
  mergedInto: z.object({ id: z.uuid(), mrn: z.string() }).nullable(),
  identifiers: z.array(identifierViewSchema),
});
export type PatientSummaryView = z.infer<typeof patientSummarySchema>;

export const patientSearchResultSchema = z.object({ by: z.string(), items: z.array(patientSummarySchema) });

export const patientDetailSchema = patientSummarySchema.extend({
  motherName: z.string().nullable(),
  address: z.string().nullable(),
  phoneMasked: z.string().nullable(),
});
export type PatientDetailView = z.infer<typeof patientDetailSchema>;

export const consentViewSchema = z.object({
  id: z.uuid(),
  kind: z.enum(PRIVACY_CONSENT_KINDS),
  recipient: z.string().nullable(),
  active: z.boolean(),
  givenAt: z.string(),
});
export type ConsentView = z.infer<typeof consentViewSchema>;

/** Persetujuan umum rawat jalan yang masih berlaku (umum, tanpa penerima), null bila belum ada. */
export function activeGeneralConsent(list: readonly ConsentView[]): ConsentView | null {
  return list.find((c) => c.kind === 'umum' && c.recipient === null && c.active) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Pasien
// ---------------------------------------------------------------------------------------------------------------

export function maskedIdentifier(p: PatientSummaryView, system: 'nik' | 'bpjs'): string | null {
  return p.identifiers.find((i) => i.system === system)?.masked ?? null;
}

/** Umur dalam tahun pada `today` (`YYYY-MM-DD`); null bila tanggal lahir tidak diketahui. */
export function ageYears(birthDate: string | null, today: string): number | null {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/**
 * Isi kotak cari yang sekaligus nomor peserta mentah (diketik/dipindai petugas): 13 digit = no. kartu BPJS, 16 digit
 * = NIK. Dipakai untuk mengisi awal cek kepesertaan (API tidak pernah mengembalikan nomor utuh).
 */
export function participantFromQuery(q: string): { by: 'kartu' | 'nik'; value: string } | null {
  const v = q.replace(/[\s.-]/g, '');
  if (/^\d{13}$/.test(v)) return { by: 'kartu', value: v };
  if (/^\d{16}$/.test(v)) return { by: 'nik', value: v };
  return null;
}

/** Empat digit terakhir dua bentuk tersamar sama → kemungkinan nomor yang sama (pemeriksaan ringan, bukan bukti). */
export function sameMaskedTail(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const tail = (s: string) => s.replace(/\D/g, '').slice(-4);
  return tail(a) === tail(b);
}

// ---------------------------------------------------------------------------------------------------------------
// Penjaminan BPJS: rujukan → jenis kunjungan, diagnosa awal
// ---------------------------------------------------------------------------------------------------------------

export function visitKindOf(r: Referral): BpjsVisitKind {
  return r.kind === 'surat-kontrol' ? 'kontrol' : 'rujukan_fktp';
}

/** Teks isian diagnosa dari rujukan (`I10 · Hipertensi esensial`). */
export function diagnosisText(r: Referral): string {
  return `${r.diagnosis.code} · ${r.diagnosis.label}`;
}

/**
 * Isian diagnosa awal → ICD-10 (kode + teks). Kode di depan wajib sah; teks diambil dari isian, atau dari rujukan bila
 * kodenya sama, atau kode itu sendiri. Null bila kode tidak sah (kode tidak pernah dikarang, CLAUDE.md §4.10).
 */
export function parseDiagnosis(text: string, referral: Referral | null): Icd10Coding | null {
  const v = text.trim();
  const code = (v.split(/[\s·]/)[0] ?? '').toUpperCase();
  if (!ICD10_PATTERN.test(code)) return null;
  const rest = v
    .slice(code.length)
    .replace(/^[\s·:–-]+/, '')
    .trim();
  const display =
    rest || (referral && referral.diagnosis.code === code ? referral.diagnosis.label : '') || code;
  return { code, display: display.slice(0, 200) };
}

// ---------------------------------------------------------------------------------------------------------------
// Idempotency-Key: satu kunci per isi permintaan
// ---------------------------------------------------------------------------------------------------------------

/**
 * Kunci untuk mengirim `payload`: dipakai ulang bila isinya sama dengan percobaan sebelumnya (mis. jaringan putus
 * setelah API memproses → hasil sama, tanpa kunjungan kedua), kunci baru bila isinya berubah (kunci lama dengan isi
 * beda ditolak API 409 `IDEMPOTENCY_KEY_REUSED`).
 */
export function idempotencyFor(
  prev: { key: string; fingerprint: string } | null,
  payload: unknown,
  newKey: () => string,
): { key: string; fingerprint: string } {
  const fingerprint = JSON.stringify(payload);
  if (prev && prev.fingerprint === fingerprint) return prev;
  return { key: newKey(), fingerprint };
}

// ---------------------------------------------------------------------------------------------------------------
// Status SEP dan task ID Antrean BPJS
// ---------------------------------------------------------------------------------------------------------------

export interface StatusView {
  label: string;
  tone: ChipTone;
  icon: IconName;
  /** Penjelasan untuk petugas (alasan gagal, tindak lanjut). */
  detail: string;
}

/** Chip status SEP (teks + ikon, tidak hanya warna). */
export function sepStatusView(sep: Sep): StatusView {
  switch (sep.status) {
    case 'issued':
      return {
        label: 'SEP terbit',
        tone: 'success',
        icon: 'check',
        detail: sep.sepNo ? `No. SEP ${sep.sepNo}` : 'Nomor SEP tercatat',
      };
    case 'pending':
      return {
        label: 'SEP menunggu BPJS',
        tone: 'warning',
        icon: 'clock',
        detail: sep.sync.error
          ? `Belum terkirim: ${sep.sync.error.message}. Dicoba ulang otomatis sampai akhir hari layanan; pasien tetap boleh ke poli.`
          : 'Sedang dikirim ke VClaim. Pasien tetap boleh ke poli; status diperbarui otomatis.',
      };
    case 'failed':
      return {
        label: sep.sync.status === 'dead' ? 'SEP gagal dikirim' : 'SEP ditolak BPJS',
        tone: 'danger',
        icon: 'alert',
        detail: `${sep.rejectionReason ?? sep.sync.error?.message ?? 'Alasan tidak diketahui'}${
          sep.lastErrorCode ? ` (${sep.lastErrorCode})` : ''
        }. Perbaiki data bila perlu, lalu kirim ulang.`,
      };
    case 'cancelled':
      return { label: 'SEP dibatalkan', tone: 'neutral', icon: 'x', detail: sep.cancelReason ?? '' };
  }
}

/** SEP yang masih bisa berubah sendiri (worker) → layar terus memperbarui. */
export function sepSettled(sep: Sep | null): boolean {
  return !sep || sep.status === 'issued' || sep.status === 'failed' || sep.status === 'cancelled';
}

export const QUEUE_TASKS_SHOWN = [1, 2, 3] as const;
const TASK_LABEL: Record<(typeof QUEUE_TASKS_SHOWN)[number], string> = {
  1: 'Task 1 · tunggu admisi',
  2: 'Task 2 · layan admisi',
  3: 'Task 3 · tunggu poli',
};

export interface TaskChipView extends StatusView {
  taskId: (typeof QUEUE_TASKS_SHOWN)[number];
  at: string | null;
}

const SYNC_VIEW: Record<BpjsSyncStatus, Omit<StatusView, 'detail'>> = {
  not_required: { label: 'tidak dikirim', tone: 'neutral', icon: 'info' },
  pending: { label: 'menunggu kirim', tone: 'warning', icon: 'clock' },
  sent: { label: 'terkirim', tone: 'success', icon: 'check' },
  rejected: { label: 'ditolak', tone: 'danger', icon: 'alert' },
  dead: { label: 'gagal', tone: 'danger', icon: 'alert' },
};

/**
 * Chip task 1–3 Antrean BPJS satu booking. Task yang belum tercatat = "belum tercatat" (mis. task 2 untuk pasien
 * yang tidak lewat loket ber-tiket).
 */
export function taskChips(tasks: readonly BpjsQueueTask[]): TaskChipView[] {
  return QUEUE_TASKS_SHOWN.map((taskId) => {
    const t = tasks.find((x) => x.taskId === taskId);
    if (!t) {
      return {
        taskId,
        at: null,
        label: `${TASK_LABEL[taskId]}: belum tercatat`,
        tone: 'neutral',
        icon: 'info',
        detail: '',
      };
    }
    const v = SYNC_VIEW[t.sync.status];
    return {
      taskId,
      at: t.at,
      label: `${TASK_LABEL[taskId]}: ${v.label}`,
      tone: v.tone,
      icon: v.icon,
      detail: t.sync.error ? t.sync.error.message : '',
    };
  });
}

/** Task yang masih menunggu kirim → layar terus memperbarui. */
export function tasksSettled(tasks: readonly BpjsQueueTask[]): boolean {
  return tasks.every((t) => t.sync.status !== 'pending');
}
