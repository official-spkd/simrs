/**
 * B05 · Penggajian (struktur, rencana fase 8 §8.3): komponen pendapatan dan potongan, slip per pegawai, run periode
 * `draf → dihitung → disetujui → diposting`, dan jurnal gaji berpasangan (debit = kredit). Semua nominal bigint
 * rupiah; persentase iuran adalah TARIF SIMULASI (dikonfirmasi bagian keuangan sebelum dipakai). PPh 21 diisi
 * manual (struktur, sesuai keputusan rencana fase 8).
 */

export interface PayInput {
  employeeId: string;
  name: string;
  position: string;
  base: bigint;
  positionAllowance: bigint;
  functionalAllowance: bigint;
  /** Jasa pelayanan dari U08 (0 sampai diimpor). */
  serviceFee: bigint;
  /** PPh 21 bulan ini, diisi manual; null = belum diisi. */
  pph21: bigint | null;
}

/** Tarif simulasi (persen dari dasar iuran) dan batas dasar iuran. */
export const CONTRIBUTION = {
  bpjsKesehatan: { pct: 1n, cap: 12_000_000n, label: 'Iuran BPJS Kesehatan (1%)' },
  jht: { pct: 2n, cap: null, label: 'Iuran JHT (2%)' },
  jp: { pct: 1n, cap: 10_000_000n, label: 'Iuran JP (1%)' },
} as const;

export type SlipLine = readonly [label: string, amount: bigint];

export interface Slip {
  earnings: SlipLine[];
  deductions: SlipLine[];
  gross: bigint;
  totalDeductions: bigint;
  net: bigint;
}

const pctOf = (amount: bigint, pct: bigint, cap: bigint | null) =>
  ((cap !== null && amount > cap ? cap : amount) * pct) / 100n;

/** Dasar iuran = gaji pokok + tunjangan tetap (jasa pelayanan tidak termasuk). */
export function contributionBase(
  p: Pick<PayInput, 'base' | 'positionAllowance' | 'functionalAllowance'>,
): bigint {
  return p.base + p.positionAllowance + p.functionalAllowance;
}

export function computeSlip(p: PayInput): Slip {
  const earnings: SlipLine[] = [
    ['Gaji pokok', p.base],
    ['Tunjangan jabatan', p.positionAllowance],
    ['Tunjangan fungsional', p.functionalAllowance],
    ['Jasa pelayanan', p.serviceFee],
  ];
  const basis = contributionBase(p);
  const deductions: SlipLine[] = [
    [
      CONTRIBUTION.bpjsKesehatan.label,
      pctOf(basis, CONTRIBUTION.bpjsKesehatan.pct, CONTRIBUTION.bpjsKesehatan.cap),
    ],
    [CONTRIBUTION.jht.label, pctOf(basis, CONTRIBUTION.jht.pct, CONTRIBUTION.jht.cap)],
    [CONTRIBUTION.jp.label, pctOf(basis, CONTRIBUTION.jp.pct, CONTRIBUTION.jp.cap)],
    ['PPh 21 (diisi manual)', p.pph21 ?? 0n],
  ];
  const gross = earnings.reduce((n, [, a]) => n + a, 0n);
  const totalDeductions = deductions.reduce((n, [, a]) => n + a, 0n);
  return { earnings, deductions, gross, totalDeductions, net: gross - totalDeductions };
}

export const RUN_STAGES = ['Draf', 'Dihitung', 'Disetujui', 'Diposting'] as const;

/** Hitung hanya setelah jasa pelayanan diimpor dan PPh 21 semua pegawai terisi. */
export function calculateBlock(lines: readonly PayInput[], serviceImported: boolean): string | null {
  if (!serviceImported) return 'Impor jasa pelayanan periode ini dari modul jasa pelayanan dulu.';
  const missing = lines.filter((l) => l.pph21 === null).length;
  if (missing > 0) return `PPh 21 belum diisi untuk ${missing} pegawai.`;
  return null;
}

/** Pemisahan tugas: penyusun ≠ penyetuju. */
export function payrollApproveBlock(preparer: string, approver: string): string | null {
  return preparer === approver ? 'Penyetuju harus berbeda dari penyusun run gaji (pemisahan tugas).' : null;
}

export interface JournalLine {
  account: string;
  debit: bigint;
  credit: bigint;
}

/** Jurnal posting gaji: beban (bruto) = utang gaji (neto) + utang iuran + utang PPh 21. */
export function payrollJournal(slips: readonly Slip[]): JournalLine[] {
  const gross = slips.reduce((n, s) => n + s.gross, 0n);
  const net = slips.reduce((n, s) => n + s.net, 0n);
  const pph = slips.reduce((n, s) => n + (s.deductions[3]?.[1] ?? 0n), 0n);
  const contrib = slips.reduce((n, s) => n + s.totalDeductions, 0n) - pph;
  return [
    { account: '6-1100 Beban gaji dan tunjangan', debit: gross, credit: 0n },
    { account: '2-1410 Utang gaji', debit: 0n, credit: net },
    { account: '2-1420 Utang iuran BPJS', debit: 0n, credit: contrib },
    { account: '2-1430 Utang PPh 21', debit: 0n, credit: pph },
  ];
}

export function journalBalanced(lines: readonly JournalLine[]): boolean {
  const d = lines.reduce((n, l) => n + l.debit, 0n);
  const c = lines.reduce((n, l) => n + l.credit, 0n);
  return d === c;
}

/** "1.250.000" / "Rp 1.250.000" → bigint; null bila bukan rupiah utuh. */
export function parseRupiahInput(s: string): bigint | null {
  const digits = s
    .replace(/^Rp\s*/i, '')
    .replace(/\./g, '')
    .trim();
  return /^\d{1,12}$/.test(digits) ? BigInt(digits) : null;
}
