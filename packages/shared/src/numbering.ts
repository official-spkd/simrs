import { periodYYMM } from './datetime';

/**
 * P08 · Format nomor dokumen (docs/04-data-model.md §5). Nilai urut dialokasikan database per
 * tenant × jenis × periode; di sini hanya pemformatan dan batas kapasitas.
 */
type Period = 'none' | 'month';

interface NumberKindDef {
  label: string;
  period: Period;
  /** Nilai maksimum yang masih muat dalam format. */
  max: bigint;
  format: (value: bigint, period: string) => string;
}

const pad = (v: bigint, digits: number) => v.toString().padStart(digits, '0');

export const NUMBER_KINDS = {
  mrn: {
    label: 'Nomor rekam medis',
    period: 'none',
    max: 99_999_999n,
    // 8 digit dikelompokkan 2-2: 00-41-27-88
    format: (v) => pad(v, 8).replace(/(\d{2})(?=\d)/g, '$1-'),
  },
  encounter_rj: {
    label: 'Kunjungan rawat jalan',
    period: 'month',
    max: 999_999n,
    format: (v, p) => `RJ-${p}-${pad(v, 6)}`,
  },
  encounter_igd: {
    label: 'Kunjungan IGD',
    period: 'month',
    max: 999_999n,
    format: (v, p) => `IGD-${p}-${pad(v, 6)}`,
  },
  encounter_ri: {
    label: 'Kunjungan rawat inap',
    period: 'month',
    max: 999_999n,
    format: (v, p) => `RI-${p}-${pad(v, 6)}`,
  },
  invoice: { label: 'Invoice', period: 'month', max: 99_999n, format: (v, p) => `INV-${p}-${pad(v, 5)}` },
  journal: { label: 'Jurnal umum', period: 'month', max: 9_999n, format: (v, p) => `JU-${p}${pad(v, 4)}` },
  payment_bill: {
    label: 'Tagihan pembayaran',
    period: 'month',
    max: 9_999n,
    format: (v, p) => `INV-DP-${p}-${pad(v, 4)}`,
  },
} as const satisfies Record<string, NumberKindDef>;

export type NumberKind = keyof typeof NUMBER_KINDS;

export function numberPeriod(kind: NumberKind, at: Date): string {
  return NUMBER_KINDS[kind].period === 'month' ? periodYYMM(at) : '';
}

/** Format nilai urut menjadi nomor dokumen. Melempar bila kapasitas format terlampaui (bukan diam-diam terpotong). */
export function formatDocumentNumber(kind: NumberKind, value: bigint, period: string): string {
  const def: NumberKindDef = NUMBER_KINDS[kind];
  if (value < 1n || value > def.max) {
    throw new RangeError(`Kapasitas nomor ${def.label} habis untuk periode "${period || '-'}"`);
  }
  return def.format(value, period);
}
