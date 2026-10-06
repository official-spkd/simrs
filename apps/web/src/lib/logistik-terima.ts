import { shiftDate } from './demo/fixtures/waktu';

/**
 * B01 · Penerimaan barang (rencana fase 8 §8.1b): jumlah diterima ≤ dipesan, batch dan kedaluwarsa wajib
 * (`supply.min_expiry_months` = 6), rantai dingin dicek bila ada; nilai penerimaan menambah persediaan dan utang
 * usaha pemasok dalam satu jurnal berpasangan (debit = kredit). Rupiah bigint.
 */

export const MIN_EXPIRY_MONTHS = 6;
export const PAYABLE_TERM_DAYS = 30;

export interface ReceiptLine {
  itemId: string;
  name: string;
  unit: string;
  ordered: number;
  /** Rupiah, bigint dalam string. */
  unitPrice: string;
  cold?: boolean;
}

export interface ReceiptInput {
  received: string;
  batch: string;
  expiry: string;
}

function monthsBetween(from: string, to: string): number {
  const [fy = 0, fm = 1, fd = 1] = from.split('-').map(Number);
  const [ty = 0, tm = 1, td = 1] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

export function lineBlock(line: ReceiptLine, input: ReceiptInput, today: string): string | null {
  const qty = Number(input.received);
  if (!/^\d+$/.test(input.received.trim()) || qty < 1) return `${line.name}: isi jumlah diterima.`;
  if (qty > line.ordered) return `${line.name}: diterima melebihi pesanan (${line.ordered}).`;
  if (input.batch.trim().length < 3) return `${line.name}: isi nomor batch.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiry)) return `${line.name}: isi kedaluwarsa TTTT-BB-HH.`;
  if (monthsBetween(today, input.expiry) < MIN_EXPIRY_MONTHS) {
    return `${line.name}: kedaluwarsa kurang dari ${MIN_EXPIRY_MONTHS} bulan, tolak atau minta persetujuan apoteker penanggung jawab.`;
  }
  return null;
}

export function receiptBlock(
  lines: readonly ReceiptLine[],
  inputs: Readonly<Record<string, ReceiptInput>>,
  today: string,
  coldChainOk: boolean,
): string | null {
  for (const l of lines) {
    const b = lineBlock(l, inputs[l.itemId] ?? { received: '', batch: '', expiry: '' }, today);
    if (b) return b;
  }
  if (lines.some((l) => l.cold) && !coldChainOk)
    return 'Centang suhu rantai dingin 2–8 °C sesuai saat diterima.';
  return null;
}

export function receiptValue(
  lines: readonly ReceiptLine[],
  inputs: Readonly<Record<string, ReceiptInput>>,
): bigint {
  return lines.reduce((n, l) => {
    const raw = (inputs[l.itemId]?.received ?? '').trim();
    return n + BigInt(l.unitPrice) * (/^\d{1,9}$/.test(raw) ? BigInt(raw) : 0n);
  }, 0n);
}

export interface JournalLine {
  account: string;
  debit: bigint;
  credit: bigint;
}

export function receiptJournal(value: bigint): JournalLine[] {
  return [
    { account: '1-1410 Persediaan obat dan BHP', debit: value, credit: 0n },
    { account: '2-1110 Utang usaha — pemasok', debit: 0n, credit: value },
  ];
}

export function payableDue(today: string, days = PAYABLE_TERM_DAYS): string {
  return shiftDate(today, days);
}

/** Nomor penerimaan barang per periode (format sama dengan hutang usaha, mis. `GRN-2610-0144`). */
export function grNumber(seq: number, period = '2610'): string {
  return `GRN-${period}-${String(seq).padStart(4, '0')}`;
}
