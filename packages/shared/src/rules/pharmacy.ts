import type { SupportErrorCode } from '../errors';
import type { PharmacyCdsAlert } from '../schemas/penunjang';
import type { ReviewDecision } from '../schemas/penunjang-api';

/**
 * S04/S05 · Aturan murni farmasi klinis, dispensing, dan stok (rencana fase 4 §4.0a, keputusan no. 9/12/23). Dipindah
 * dari `apps/web/src/lib/penunjang-farmasi.ts`; `pickFefo` baru. Dipakai API (berwenang), web, dan mode presentasi.
 */

/**
 * Peringatan CDS yang menahan telaah: mayor/sedang yang masih terbuka, dan override dokter atas peringatan mayor
 * (wajib ditinjau apoteker). Info tidak pernah menahan.
 */
export function alertBlocks(a: Pick<PharmacyCdsAlert, 'status' | 'level'>): boolean {
  return (a.status === 'terbuka' && a.level !== 'info') || (a.status === 'override' && a.level === 'mayor');
}

/** Keputusan telaah: `setujui` diblokir selama ada peringatan yang menahan (409 `CDS_UNRESOLVED`). */
export function reviewBlock(
  decision: ReviewDecision,
  alerts: readonly Pick<PharmacyCdsAlert, 'status' | 'level'>[],
): Extract<SupportErrorCode, 'CDS_UNRESOLVED'> | null {
  return decision === 'setujui' && alerts.some(alertBlocks) ? 'CDS_UNRESOLVED' : null;
}

/** Penyiapan/penyerahan: resep dengan obat kewaspadaan tinggi wajib cek ganda apoteker kedua (bukan penyiap). */
export function dispenseDoubleCheckBlock(s: {
  preparedBy: string;
  checkerUserId: string;
}): Extract<SupportErrorCode, 'DOUBLE_CHECK_SAME_USER'> | null {
  return s.preparedBy === s.checkerUserId ? 'DOUBLE_CHECK_SAME_USER' : null;
}

export function handoverBlock(s: {
  hasHighAlert: boolean;
  doubleChecked: boolean;
}): Extract<SupportErrorCode, 'HIGH_ALERT_DOUBLE_CHECK_REQUIRED'> | null {
  return s.hasHighAlert && !s.doubleChecked ? 'HIGH_ALERT_DOUBLE_CHECK_REQUIRED' : null;
}

export interface FefoBatch {
  id: string;
  /** Tanggal kedaluwarsa `YYYY-MM-DD`. */
  expiryDate: string;
  /** Saldo di depo ini. */
  quantity: number;
}

export interface FefoPick {
  batchId: string;
  quantity: number;
}

/** Batch sudah kedaluwarsa pada tanggal `today` (WIB, `YYYY-MM-DD`): ED ≤ hari ini tidak boleh keluar ke pasien. */
export function batchExpired(expiryDate: string, today: string): boolean {
  return expiryDate <= today;
}

/** Batch mendekati ED: sisa hari < `warningDays` (pengaturan `stock.expiry_warning_days`). */
export function batchExpiringSoon(expiryDate: string, today: string, warningDays: number): boolean {
  const days = (Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return days >= 0 && days < warningDays;
}

/**
 * FEFO (first expired, first out): ambil dari batch yang belum kedaluwarsa dengan ED terdekat dulu (seri = id),
 * dipecah lintas batch bila perlu. Melempar `STOCK_INSUFFICIENT` bila total tidak cukup. Batch kedaluwarsa tidak
 * pernah ditawarkan (`BATCH_EXPIRED` hanya untuk pilihan manual).
 */
export function pickFefo(
  batches: readonly FefoBatch[],
  quantity: number,
  today: string,
): { ok: true; picks: FefoPick[] } | { ok: false; code: Extract<SupportErrorCode, 'STOCK_INSUFFICIENT'> } {
  if (!Number.isInteger(quantity) || quantity <= 0)
    throw new RangeError('Jumlah FEFO harus bilangan bulat > 0');
  const usable = batches
    .filter((b) => b.quantity > 0 && !batchExpired(b.expiryDate, today))
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.id.localeCompare(b.id));
  const picks: FefoPick[] = [];
  let left = quantity;
  for (const b of usable) {
    if (left === 0) break;
    const take = Math.min(left, b.quantity);
    picks.push({ batchId: b.id, quantity: take });
    left -= take;
  }
  return left === 0 ? { ok: true, picks } : { ok: false, code: 'STOCK_INSUFFICIENT' };
}

/** Pilihan batch manual (override FEFO): tidak kedaluwarsa dan saldo cukup. */
export function manualBatchBlock(
  batch: FefoBatch,
  quantity: number,
  today: string,
): Extract<SupportErrorCode, 'BATCH_EXPIRED' | 'STOCK_INSUFFICIENT'> | null {
  if (batchExpired(batch.expiryDate, today)) return 'BATCH_EXPIRED';
  if (batch.quantity < quantity) return 'STOCK_INSUFFICIENT';
  return null;
}
