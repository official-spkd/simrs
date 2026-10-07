import { periodYYMM, periodYYMMDD } from './datetime';

/**
 * P08 · Format nomor dokumen (docs/04-data-model.md §5). Nilai urut dialokasikan database per
 * tenant × jenis × periode (× lingkup, untuk jenis berlingkup); di sini hanya pemformatan dan batas kapasitas.
 */
type Period = 'none' | 'month' | 'day';

interface NumberKindDef {
  label: string;
  period: Period;
  /**
   * Jenis berlingkup: urutan terpisah per lingkup di dalam periode (mis. per layanan antrean per hari), dan lingkup
   * ikut membentuk nomor. Jenis tanpa lingkup tidak boleh diberi lingkup.
   */
  scope?: 'queue_service';
  /** Nilai maksimum yang masih muat dalam format. */
  max: bigint;
  format: (value: bigint, period: string, scope: string) => string;
}

const pad = (v: bigint, digits: number) => v.toString().padStart(digits, '0');

/** Kode layanan antrean = awalan nomor antrean: poli `PD`, loket admisi `A`, farmasi `F` (docs/04 §5). */
export const QUEUE_PREFIX_PATTERN = /^[A-Z]{1,2}$/;

/** S01 · Nomor laboratorium `L` + YYMMDD + 4 digit (kontrak `labSampleSchema.labNo`). */
export const LAB_NO_PATTERN = /^L\d{10}$/;

/** Kode booking 10 digit: `YYMMDD` tanggal layanan + 4 digit urut (mis. `2610050117`, anjungan: keypad 10 digit). */
export const BOOKING_CODE_PATTERN = /^\d{10}$/;

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
  /** F07 · Rujukan internal antarpoli (konsul), nomor RS sendiri (bukan BPJS). */
  referral_internal: {
    label: 'Rujukan internal',
    period: 'month',
    max: 999_999n,
    format: (v, p) => `RIN-${p}-${pad(v, 6)}`,
  },
  /** F07 · Rujukan keluar pasien non-BPJS (surat RS); rujukan keluar BPJS bernomor dari VClaim. */
  referral_out: {
    label: 'Rujukan keluar (non-BPJS)',
    period: 'month',
    max: 999_999n,
    format: (v, p) => `RK-${p}-${pad(v, 6)}`,
  },
  invoice: { label: 'Invoice', period: 'month', max: 99_999n, format: (v, p) => `INV-${p}-${pad(v, 5)}` },
  journal: { label: 'Jurnal umum', period: 'month', max: 9_999n, format: (v, p) => `JU-${p}${pad(v, 4)}` },
  payment_bill: {
    label: 'Tagihan pembayaran',
    period: 'month',
    max: 9_999n,
    format: (v, p) => `INV-DP-${p}-${pad(v, 4)}`,
  },
  /**
   * F02 · Kode booking. Periode = tanggal LAYANAN (bukan tanggal pemesanan), sehingga anjungan bisa menolak kode
   * hari lain tanpa query. Nomor urut mudah ditebak: pencarian publik/anjungan wajib berpasangan tanggal lahir
   * (di body) dan dibatasi laju (rencana fase 2 §5).
   */
  booking_code: {
    label: 'Kode booking',
    period: 'day',
    max: 9_999n,
    format: (v, p) => `${p}${pad(v, 4)}`,
  },
  // S01–S08 · Penunjang (fase 4, rencana §4.0a)
  /** S01 · Nomor laboratorium (barcode tabung): `L` + YYMMDD + 4 digit, urut harian (`L2610070001`). */
  lab_no: { label: 'Nomor laboratorium', period: 'day', max: 9_999n, format: (v, p) => `L${p}${pad(v, 4)}` },
  /** S03 · Nomor akses radiologi (siap untuk PACS/MWL): `RAD-YYMM-NNNN`. */
  rad_accession: {
    label: 'Nomor akses radiologi',
    period: 'month',
    max: 9_999n,
    format: (v, p) => `RAD-${p}-${pad(v, 4)}`,
  },
  /** S04 · Nomor resep farmasi: `R-YYMM-NNNN`. */
  prescription_no: {
    label: 'Nomor resep',
    period: 'month',
    max: 9_999n,
    format: (v, p) => `R-${p}-${pad(v, 4)}`,
  },
  /** S06 · Nomor kasus kamar operasi: `OK-YYMM-NNNN`. */
  surgery_case: {
    label: 'Nomor kasus operasi',
    period: 'month',
    max: 9_999n,
    format: (v, p) => `OK-${p}-${pad(v, 4)}`,
  },
  /** S05 · Penerimaan barang depo/gudang: `TRM-YYMM-NNNN`. */
  stock_receipt: {
    label: 'Penerimaan stok',
    period: 'month',
    max: 9_999n,
    format: (v, p) => `TRM-${p}-${pad(v, 4)}`,
  },
  /** S05 · Mutasi antar-depo: `MUT-YYMM-NNNN`. */
  stock_transfer: {
    label: 'Mutasi stok',
    period: 'month',
    max: 9_999n,
    format: (v, p) => `MUT-${p}-${pad(v, 4)}`,
  },
  /** S08 · Permintaan darah: `BD-YYMM-NNNN`. */
  blood_request: {
    label: 'Permintaan darah',
    period: 'month',
    max: 9_999n,
    format: (v, p) => `BD-${p}-${pad(v, 4)}`,
  },
  /** F04 · Nomor antrean `<kode layanan>-<3 digit>` per layanan per hari: `PD-027`, `A-031`, `F-021`. */
  queue_ticket: {
    label: 'Nomor antrean',
    period: 'day',
    scope: 'queue_service',
    max: 999n,
    format: (v, _p, prefix) => `${prefix}-${pad(v, 3)}`,
  },
} as const satisfies Record<string, NumberKindDef>;

export type NumberKind = keyof typeof NUMBER_KINDS;

/** Jenis yang urutannya per lingkup (mis. layanan antrean); alokasinya butuh kunci lingkup, bukan hanya periode. */
export function isScopedNumberKind(kind: NumberKind): boolean {
  return (NUMBER_KINDS[kind] as NumberKindDef).scope !== undefined;
}

/**
 * Periode nomor: `''` (tanpa periode), `YYMM` (bulanan), atau `YYMMDD` (harian, WIB). Untuk kode booking, `at`
 * adalah tanggal layanan (`YYYY-MM-DD`).
 */
export function numberPeriod(kind: NumberKind, at: Date | string): string {
  const period: Period = NUMBER_KINDS[kind].period;
  if (period === 'month') return periodYYMM(at);
  if (period === 'day') return periodYYMMDD(at);
  return '';
}

/**
 * Format nilai urut menjadi nomor dokumen. Melempar bila kapasitas format terlampaui (bukan diam-diam terpotong),
 * bila jenis berlingkup tidak diberi lingkup yang sah, atau jenis tanpa lingkup diberi lingkup.
 */
export function formatDocumentNumber(kind: NumberKind, value: bigint, period: string, scope = ''): string {
  const def: NumberKindDef = NUMBER_KINDS[kind];
  if (def.scope === 'queue_service' ? !QUEUE_PREFIX_PATTERN.test(scope) : scope !== '') {
    throw new RangeError(`Lingkup nomor ${def.label} tidak valid: "${scope}"`);
  }
  if (value < 1n || value > def.max) {
    throw new RangeError(`Kapasitas nomor ${def.label} habis untuk periode "${period || '-'}"`);
  }
  return def.format(value, period, scope);
}

/** Nomor antrean `<awalan>-<3 digit>` (bentuk singkat `formatDocumentNumber('queue_ticket', …)`). */
export function formatQueueTicket(prefix: string, value: bigint | number): string {
  return formatDocumentNumber('queue_ticket', BigInt(value), '', prefix);
}

/** Tanggal layanan (`YYYY-MM-DD`) yang tertanam di kode booking, atau null bila bukan kode booking yang sah. */
export function bookingCodeServiceDate(code: string): string | null {
  if (!BOOKING_CODE_PATTERN.test(code)) return null;
  const iso = `20${code.slice(0, 2)}-${code.slice(2, 4)}-${code.slice(4, 6)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
