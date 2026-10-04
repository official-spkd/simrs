import {
  type Drawdown,
  type FinancingFacility,
  formatRupiah,
  type InstalmentApplication,
  type InstalmentStage,
  type ReceivableBatch,
} from '@simrs/shared';
import type { ChipTone } from '@simrs/ui';

/**
 * U04 · Aritmetika pembiayaan BTN (murni, bigint): advance rate piutang BPJS, margin harian, pelunasan otomatis
 * dari rekening penampungan, dan estimasi angsuran cicilan pasien. Semua parameter simulasi (docs/07 §4–5).
 */

/** Advance = nilai klaim × advance rate (dibulatkan ke bawah, rupiah utuh). */
export function advanceAmount(claim: bigint, ratePercent: number): bigint {
  if (!Number.isInteger(ratePercent) || ratePercent < 0 || ratePercent > 100) {
    throw new RangeError(`Advance rate tidak sah: ${ratePercent}`);
  }
  return (claim * BigInt(ratePercent)) / 100n;
}

/** Margin harian sejak cair: pokok × bps/10.000 × hari/365, dibulatkan ke Rp 100 terdekat. */
export function marginFor(principal: bigint, marginBps: number, days: number): bigint {
  if (days <= 0 || principal <= 0n) return 0n;
  const num = principal * BigInt(marginBps) * BigInt(days);
  const den = 10_000n * 365n;
  return ((num + den * 50n) / (den * 100n)) * 100n;
}

export interface Repayment {
  /** Pokok + margin yang didebit otomatis dari rekening penampungan. */
  debit: bigint;
  /** Sisa yang diteruskan ke rekening operasional RS. */
  forwarded: bigint;
}

/** Pembayaran BPJS ke penampungan: auto-debit pokok + margin, sisanya ke operasional. */
export function repaymentSplit(bpjsPaid: bigint, principal: bigint, margin: bigint): Repayment {
  const debit = principal + margin;
  if (debit > bpjsPaid) throw new RangeError('Pembayaran BPJS lebih kecil dari pokok + margin');
  return { debit, forwarded: bpjsPaid - debit };
}

/** Hari kalender antara dua tanggal ISO `YYYY-MM-DD` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Estimasi angsuran bulanan cicilan pasien: margin flat per tahun, dibulatkan ke Rp 1.000 terdekat. */
export function monthlyInstalment(amount: bigint, tenorMonths: number, marginPercentPa: number): bigint {
  if (!Number.isInteger(tenorMonths) || tenorMonths < 1) throw new RangeError('Tenor tidak sah');
  if (!Number.isInteger(marginPercentPa)) throw new RangeError('Margin harus persen bulat');
  const num = amount * BigInt(1200 + marginPercentPa * tenorMonths);
  const den = 1200n * BigInt(tenorMonths);
  return ((num + den * 500n) / (den * 1000n)) * 1000n;
}

export interface FacilityPosition {
  outstanding: bigint;
  /** Pokok pengajuan yang sedang diproses (mengurangi sisa plafon). */
  reserved: bigint;
  available: bigint;
  /** Margin berjalan seluruh pencairan aktif per tanggal `asOf`. */
  marginRunning: bigint;
  activeCount: number;
}

export function facilityPosition(
  facility: FinancingFacility,
  drawdowns: readonly Drawdown[],
  asOf: string,
): FacilityPosition {
  let outstanding = 0n;
  let reserved = 0n;
  let marginRunning = 0n;
  let activeCount = 0;
  for (const d of drawdowns) {
    const p = BigInt(d.principal);
    if (d.stage === 'cair') {
      outstanding += p;
      activeCount++;
      if (d.disbursedOn) marginRunning += marginFor(p, facility.marginBps, daysBetween(d.disbursedOn, asOf));
    } else if (d.stage === 'diajukan' || d.stage === 'disetujui') {
      reserved += p;
    }
  }
  const left = BigInt(facility.limit) - outstanding - reserved;
  return { outstanding, reserved, available: left > 0n ? left : 0n, marginRunning, activeCount };
}

/** Batch yang bisa dijaminkan: layak bayar dan belum dipakai pencairan mana pun. */
export function eligibleBatches(
  pool: readonly ReceivableBatch[],
  drawdowns: readonly Drawdown[],
): ReceivableBatch[] {
  const used = new Set(drawdowns.flatMap((d) => d.batchIds));
  return pool.filter((b) => b.status === 'layak' && !b.drawdownId && !used.has(b.id));
}

export interface DrawdownQuote {
  claims: bigint;
  advance: bigint;
  /** Nilai cair = advance, dibatasi sisa plafon. */
  disburse: bigint;
  cappedByLimit: boolean;
}

export function quoteDrawdown(
  selected: readonly ReceivableBatch[],
  ratePercent: number,
  available: bigint,
): DrawdownQuote {
  const claims = selected.reduce((s, b) => s + BigInt(b.amount), 0n);
  const advance = advanceAmount(claims, ratePercent);
  const capped = advance > available;
  return {
    claims,
    advance,
    disburse: capped ? available : advance,
    cappedByLimit: capped && selected.length > 0,
  };
}

/**
 * Pemeriksaan server untuk pengajuan pencairan (data server, bukan isian layar): setiap batch harus layak dijaminkan
 * dan tidak ganda, dan pokok tidak melebihi advance yang dihitung (dibatasi sisa plafon). null = sah.
 */
export function drawdownRequestError(
  data: {
    facility: FinancingFacility;
    pool: readonly ReceivableBatch[];
    drawdowns: readonly Drawdown[];
  },
  batchIds: readonly string[],
  principal: bigint,
  asOf: string,
): string | null {
  if (batchIds.length === 0) return 'Pilih minimal satu batch layak bayar.';
  if (new Set(batchIds).size !== batchIds.length) return 'Batch klaim dipilih lebih dari sekali.';
  const free = eligibleBatches(data.pool, data.drawdowns);
  const selected = free.filter((b) => batchIds.includes(b.id));
  if (selected.length !== batchIds.length) {
    return 'Hanya batch layak bayar yang belum dijaminkan yang bisa diajukan.';
  }
  const available = facilityPosition(data.facility, data.drawdowns, asOf).available;
  const quote = quoteDrawdown(selected, data.facility.advanceRatePercent, available);
  if (principal <= 0n) return 'Nilai pencairan tidak sah.';
  if (principal > quote.disburse) {
    return `Nilai pencairan melebihi advance ${data.facility.advanceRatePercent}% yang tersedia (${formatRupiah(quote.disburse)}).`;
  }
  return null;
}

// ---------------------------------------------------------------- cicilan pasien

export const INSTALMENT_FLOW: readonly InstalmentStage[] = [
  'diajukan',
  'verifikasi',
  'disetujui',
  'akad',
  'dicairkan',
];

export const INSTALMENT_LABEL: Record<InstalmentStage, string> = {
  diajukan: 'Diajukan',
  verifikasi: 'Verifikasi BTN',
  disetujui: 'Disetujui',
  akad: 'Akad TTE',
  dicairkan: 'Dicairkan',
  ditolak: 'Ditolak',
};

export const INSTALMENT_TONE: Record<InstalmentStage, ChipTone> = {
  diajukan: 'neutral',
  verifikasi: 'info',
  disetujui: 'brand',
  akad: 'brand',
  dicairkan: 'success',
  ditolak: 'danger',
};

/** Tahap berikutnya dalam alur (null bila sudah dicairkan atau ditolak). */
export function nextInstalmentStage(stage: InstalmentStage): InstalmentStage | null {
  const i = INSTALMENT_FLOW.indexOf(stage);
  return i < 0 || i >= INSTALMENT_FLOW.length - 1 ? null : (INSTALMENT_FLOW[i + 1] ?? null);
}

/** Penolakan hanya mungkin sebelum BTN memutuskan (diajukan/verifikasi). */
export function canReject(app: Pick<InstalmentApplication, 'stage'>): boolean {
  return app.stage === 'diajukan' || app.stage === 'verifikasi';
}

export const REJECT_REASON_MIN = 10;

const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

/** Rupiah ringkas untuk KPI: "Rp 15,00 M", "Rp 6,4 jt", di bawah sejuta tetap penuh. Pembulatan bigint. */
export function formatRingkas(amount: bigint): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const sign = neg ? '−' : '';
  if (abs >= 1_000_000_000n) {
    const h = (abs + 5_000_000n) / 10_000_000n;
    return `${sign}Rp ${(h / 100n).toString().replace(THOUSANDS, '.')},${String(h % 100n).padStart(2, '0')} M`;
  }
  if (abs >= 1_000_000n) {
    const t = (abs + 50_000n) / 100_000n;
    return `${sign}Rp ${(t / 10n).toString()},${t % 10n} jt`;
  }
  return `${sign}Rp ${abs.toString().replace(THOUSANDS, '.')}`;
}

/** Tanggal ISO + n hari (kalender). */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export interface BpjsPayment {
  drawdownId: string;
  claims: bigint;
  principal: bigint;
  margin: bigint;
  days: number;
  /** Hari diasumsikan rata-rata bila pencairan baru hari ini. */
  assumed: boolean;
  forwarded: bigint;
}

/** Simulasi BPJS membayar batch dasar pencairan: auto-debit pokok + margin, sisa ke operasional. */
export function simulateBpjsPayment(
  facility: FinancingFacility,
  drawdown: Drawdown,
  pool: readonly ReceivableBatch[],
  today: string,
): BpjsPayment {
  const claims = pool
    .filter((b) => drawdown.batchIds.includes(b.id))
    .reduce((s, b) => s + BigInt(b.amount), 0n);
  const principal = BigInt(drawdown.principal);
  const elapsed = drawdown.disbursedOn ? daysBetween(drawdown.disbursedOn, today) : 0;
  const assumed = elapsed <= 0;
  const days = assumed ? facility.avgBpjsPayDays : elapsed;
  const margin = marginFor(principal, facility.marginBps, days);
  const { forwarded } = repaymentSplit(claims, principal, margin);
  return { drawdownId: drawdown.id, claims, principal, margin, days, assumed, forwarded };
}
