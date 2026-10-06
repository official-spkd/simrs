import {
  BPJS_REJECTIONS,
  type BpjsSyncStatus,
  REFERRAL_DOC_KIND_LABEL,
  type ReferralDocKind,
  type ReferralStatus,
} from '@simrs/shared';

/**
 * F07 · Rujukan (mode presentasi, ADR-0023): rujukan masuk/keluar/internal, surat kontrol, dan SPRI dengan status
 * kirim BPJS. Jenis, status, dan kode penolakan mengikuti kontrak bersama (`schemas/referral.ts`,
 * `BPJS_REJECTIONS`); nomor BPJS hanya ada setelah BPJS menjawab (pending → active).
 */

export type RejectionCode = keyof typeof BPJS_REJECTIONS;

export interface DemoReferral {
  id: string;
  kind: ReferralDocKind;
  status: ReferralStatus;
  number: string | null;
  patientId: string;
  patientName: string;
  rm: string;
  /** Faskes perujuk/tujuan, atau poli asal/tujuan. */
  facility: string;
  /** Poli/unit tujuan di RS ini (masuk, kontrol, internal, SPRI). */
  target: string | null;
  diagnosis: { code: string; display: string };
  issuedOn: string;
  validUntil: string | null;
  plannedDate: string | null;
  practitioner: string | null;
  note: string | null;
  sync: {
    status: BpjsSyncStatus;
    sentAt: string | null;
    error: { code: string; message: string } | null;
  };
  /** Jawaban BPJS saat antrean kirim diproses (simulasi mock). */
  simOutcome?: { result: 'issued'; number: string } | { result: 'rejected'; code: RejectionCode };
  cancelReason?: string;
}

export type Direction = 'masuk' | 'keluar' | 'surat' | 'internal';

export const DIRECTION_OF: Record<ReferralDocKind, Direction> = {
  'rujukan-fktp': 'masuk',
  'rujukan-rs': 'masuk',
  'rujukan-keluar': 'keluar',
  'surat-kontrol': 'surat',
  spri: 'surat',
  'rujukan-internal': 'internal',
};

export const DIRECTION_LABEL: Record<Direction, string> = {
  masuk: 'Rujukan masuk',
  keluar: 'Rujukan keluar',
  surat: 'Surat kontrol & SPRI',
  internal: 'Internal antarpoli',
};

export const STATUS_LABEL: Record<ReferralStatus, string> = {
  pending: 'Menunggu nomor BPJS',
  active: 'Berlaku',
  used: 'Sudah dipakai',
  expired: 'Kedaluwarsa',
  cancelled: 'Dibatalkan',
};

export const SYNC_LABEL: Record<BpjsSyncStatus, string> = {
  not_required: 'Tidak dikirim ke BPJS',
  pending: 'Menunggu kirim',
  sent: 'Terbit di BPJS',
  rejected: 'Ditolak BPJS',
  dead: 'Gagal kirim (DLQ)',
};

export const kindLabel = (k: ReferralDocKind) => REFERRAL_DOC_KIND_LABEL[k];

/**
 * Proses antrean kirim (simulasi worker + mock BPJS): pending → terbit bernomor, atau ditolak dengan kode stabil.
 * Rujukan yang tidak perlu ke BPJS tidak berubah.
 */
export function processSync(r: DemoReferral, at: string): DemoReferral {
  if (r.sync.status !== 'pending' || r.status !== 'pending') return r;
  const outcome = r.simOutcome ?? {
    result: 'issued' as const,
    number: `0301R001${r.id.toUpperCase().replace(/[^0-9A-Z]/g, '')}`,
  };
  if (outcome.result === 'issued') {
    return {
      ...r,
      status: 'active',
      number: outcome.number,
      sync: { status: 'sent', sentAt: at, error: null },
      simOutcome: undefined,
    };
  }
  return {
    ...r,
    sync: {
      status: 'rejected',
      sentAt: null,
      error: { code: outcome.code, message: BPJS_REJECTIONS[outcome.code] },
    },
    simOutcome: undefined,
  };
}

export type Check = { ok: true } | { ok: false; reason: string };

/** Kirim ulang setelah ditolak/DLQ: tanggal rencana wajib diperbaiki bila penolakan soal tanggal/jadwal. */
export function canResend(r: DemoReferral, newPlannedDate: string | null, today: string): Check {
  if (r.sync.status !== 'rejected' && r.sync.status !== 'dead')
    return { ok: false, reason: 'Tidak ada kiriman yang gagal.' };
  const dateIssue = ['BPJS_TANGGAL_TIDAK_VALID', 'BPJS_JADWAL_LIBUR', 'BPJS_KUOTA_PENUH'].includes(
    r.sync.error?.code ?? '',
  );
  if (dateIssue) {
    if (!newPlannedDate) return { ok: false, reason: 'Pilih tanggal rencana baru dulu.' };
    if (newPlannedDate === r.plannedDate)
      return { ok: false, reason: 'Tanggal rencana masih sama dengan yang ditolak.' };
    if (newPlannedDate < today) return { ok: false, reason: 'Tanggal rencana tidak boleh sebelum hari ini.' };
  }
  return { ok: true };
}

export function resend(r: DemoReferral, newPlannedDate: string | null, number: string): DemoReferral {
  return {
    ...r,
    plannedDate: newPlannedDate ?? r.plannedDate,
    sync: { status: 'pending', sentAt: null, error: null },
    simOutcome: { result: 'issued', number },
  };
}

export function canCancel(r: DemoReferral): Check {
  if (r.status === 'cancelled') return { ok: false, reason: 'Sudah dibatalkan.' };
  if (r.status === 'used')
    return { ok: false, reason: 'Sudah dipakai kunjungan/SEP; tidak bisa dibatalkan.' };
  if (r.status === 'expired') return { ok: false, reason: 'Sudah kedaluwarsa.' };
  return { ok: true };
}

/** Rujukan FKTP berlaku 90 hari; peringatan bila sisa ≤ 7 hari. */
export function daysLeft(r: DemoReferral, today: string): number | null {
  if (!r.validUntil) return null;
  return Math.round((Date.parse(r.validUntil) - Date.parse(today)) / 86_400_000);
}

export function referralCounts(list: readonly DemoReferral[]) {
  return {
    pending: list.filter((r) => r.sync.status === 'pending').length,
    rejected: list.filter((r) => r.sync.status === 'rejected' || r.sync.status === 'dead').length,
    active: list.filter((r) => r.status === 'active').length,
    incomingToday: list.filter((r) => DIRECTION_OF[r.kind] === 'masuk' && r.status === 'used').length,
  };
}
