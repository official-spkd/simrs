import {
  CHARGE_CATEGORIES,
  type ChargeCategory,
  type ChargeItem,
  formatRupiah,
  type Invoice,
  type InvoiceStatus,
  isoDateJakarta,
  type PayerSplit,
  type PaymentMethod,
  sumRupiah,
} from '@simrs/shared';
import { monthlyInstalment } from './btn-pembiayaan';

/**
 * U02/U03 · Perhitungan dan format tampilan Kasir (murni, dipakai server dan klien). Uang selalu bigint; string
 * rupiah dari kontrak diubah dengan `BigInt` (tidak pernah lewat number/float).
 */

export const CATEGORY_LABEL: Record<ChargeCategory, string> = {
  igd: 'Gawat darurat (asal IGD)',
  akomodasi: 'Akomodasi',
  visite: 'Visite dan konsultasi dokter',
  tindakan: 'Tindakan dan asesmen',
  operasi: 'Kamar operasi',
  laboratorium: 'Laboratorium',
  radiologi: 'Radiologi dan diagnostik',
  obat: 'Obat dan alkes',
  administrasi: 'Administrasi dan rekam medis',
};

const CATEGORY_RULES: ReadonlyArray<[RegExp, ChargeCategory]> = [
  [/administrasi/i, 'administrasi'],
  [/igd/i, 'igd'],
  [/akomodasi|kamar kelas|kamar vip/i, 'akomodasi'],
  [/operasi|operator|anestesi|laparoskopi/i, 'operasi'],
  [/obat|bhp|alkes/i, 'obat'],
  [/lab|hba1c|lipid|kreatinin|troponin|gds|glukometer/i, 'laboratorium'],
  [/foto|ekokardiografi|ekg|rontgen|ct |usg/i, 'radiologi'],
  [/konsultasi|visite/i, 'visite'],
];

/** Kategori baris tagihan dari nama charge (charge capture mesin skenario membawa nama + tahap asal). */
export function categorizeCharge(name: string): ChargeCategory {
  return CATEGORY_RULES.find(([re]) => re.test(name))?.[1] ?? 'tindakan';
}

/** Total tagihan = jumlah baris (bigint). */
export function invoiceTotal(lines: ReadonlyArray<Pick<ChargeItem, 'amount'>>): bigint {
  return sumRupiah(lines.map((l) => BigInt(l.amount)));
}

export interface BillCategoryView {
  id: ChargeCategory;
  label: string;
  /** Jumlah item (Σ kuantitas). */
  count: number;
  amount: bigint;
  /** Sumber charge capture unik dalam kategori, mis. "LIS", "eMAR". */
  sources: string[];
  lines: ChargeItem[];
}

/** Baris dikelompokkan per kategori (urutan baku), hanya kategori yang berisi. */
export function groupLines(lines: readonly ChargeItem[]): BillCategoryView[] {
  return CHARGE_CATEGORIES.flatMap((id) => {
    const own = lines.filter((l) => l.category === id);
    if (own.length === 0) return [];
    return [
      {
        id,
        label: CATEGORY_LABEL[id],
        count: own.reduce((n, l) => n + l.qty, 0),
        amount: invoiceTotal(own),
        sources: [...new Set(own.map((l) => l.source))],
        lines: own,
      },
    ];
  });
}

/**
 * Hitung ulang pembagian penjamin untuk total baru (mis. setelah item manual): BPJS membayar tarif INA-CBG
 * (tetap), asuransi membayar jaminan yang disetujui (tetap), pasien menanggung selisih naik kelas / ekses / semua.
 */
export function recomputeSplit(split: PayerSplit, total: bigint): PayerSplit {
  const payerPays = BigInt(split.payerPays);
  let patientShare: bigint;
  if (split.scheme === 'bpjs') patientShare = BigInt(split.classUpgrade?.amount ?? '0');
  else if (split.scheme === 'asuransi') patientShare = total > payerPays ? total - payerPays : 0n;
  else patientShare = total;
  const paid =
    split.scheme === 'umum' ? 0n : split.scheme === 'asuransi' && total < payerPays ? total : payerPays;
  const absorbs = total - paid - patientShare;
  return {
    ...split,
    hospitalTotal: total.toString(),
    payerPays: paid.toString(),
    patientShare: patientShare.toString(),
    hospitalAbsorbs: absorbs.toString(),
  };
}

/** Sisa tagihan pasien = tanggungan − pembayaran diterima (tidak pernah negatif). */
export function patientDue(split: Pick<PayerSplit, 'patientShare'>, paid: readonly bigint[]): bigint {
  const due = BigInt(split.patientShare) - sumRupiah(paid);
  return due > 0n ? due : 0n;
}

/**
 * Penyelesaian tagihan = baris tagihan + item manual: total, pembagian penjamin, dan sisa bayar pasien. Dipakai
 * layar (keadaan lokal) dan Server Action (menghitung ulang dari tagihan server, tidak memercayai nominal klien).
 */
export function invoiceSettlement(
  inv: Pick<Invoice, 'lines' | 'split' | 'payments'>,
  manual: ReadonlyArray<Pick<ChargeItem, 'amount'>> = [],
): { total: bigint; split: PayerSplit; due: bigint } {
  const total = invoiceTotal([...inv.lines, ...manual]);
  const split = manual.length ? recomputeSplit(inv.split, total) : inv.split;
  return {
    total,
    split,
    due: patientDue(
      split,
      inv.payments.map((p) => BigInt(p.amount)),
    ),
  };
}

export type KasirLocalAction = 'manual' | 'final' | 'bayar' | 'tutup';

/**
 * Gerbang aksi lokal kasir terhadap tagihan versi server: pesan penolakan, atau null bila boleh. Tagihan pasien
 * skenario hanya maju lewat tugas skenario; tagihan lunas tidak bisa diubah; item manual dan finalisasi hanya
 * untuk tagihan berjalan; finalisasi dan pembayaran menunggu pasien pulang.
 */
export function localActionProblem(
  inv: Pick<Invoice, 'scenario' | 'status' | 'encounter'> | undefined,
  action: KasirLocalAction,
): string | null {
  if (!inv) return 'Tagihan tidak ditemukan di antrean kasir.';
  if (inv.scenario) return 'Tagihan pasien simulasi dimajukan lewat tugas skenario, bukan aksi lokal kasir.';
  if (inv.status === 'lunas') return 'Tagihan sudah lunas; tidak ada yang bisa diubah.';
  if ((action === 'manual' || action === 'final') && inv.status !== 'berjalan') {
    return 'Tagihan sudah final dan terkunci; koreksi lewat unit asal.';
  }
  if (action !== 'manual' && !inv.encounter.discharged) {
    return 'Pasien masih dirawat; tagihan berjalan sampai pasien pulang.';
  }
  return null;
}

/** Tanggal pelunasan (WIB `YYYY-MM-DD`): pembayaran terakhir, atau saat final bila pasien tidak membayar. */
export function settledOn(inv: Pick<Invoice, 'status' | 'payments' | 'finalizedAt'>): string | null {
  if (inv.status !== 'lunas') return null;
  const at = inv.payments.at(-1)?.at ?? inv.finalizedAt;
  return at ? isoDateJakarta(at) : null;
}

/** Jumlah tagihan lunas pada hari shift (pasien skenario dengan lini masa lain tidak ikut terhitung). */
export function settledCount(invoices: ReadonlyArray<Parameters<typeof settledOn>[0]>, day: string): number {
  return invoices.filter((i) => settledOn(i) === day).length;
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, { name: string; sub: string }> = {
  qris: { name: 'QRIS', sub: 'via TPDI · acquirer BTN' },
  va: { name: 'Virtual Account BTN', sub: 'via TPDI · berlaku 24 jam' },
  debit: { name: 'Debit / kredit', sub: 'EDC BTN terintegrasi' },
  tunai: { name: 'Tunai', sub: 'hitung kembalian' },
  transfer: { name: 'Transfer bank', sub: 'ke BTN operasional, cocokkan referensi' },
  cicilan: { name: 'Cicilan BTN', sub: 'tenor 3 / 6 / 12 bulan · angsuran dibayar pasien ke BTN' },
};

export type ViewTone = 'brand' | 'neutral' | 'warning' | 'success' | 'danger' | 'info';

/** Label status tagihan di antrean (teks, bukan hanya warna). */
export function invoiceStatusView(
  status: InvoiceStatus,
  due: bigint,
  discharged: boolean,
): { label: string; tone: ViewTone } {
  if (status === 'lunas') return { label: 'Lunas', tone: 'success' };
  if (status === 'final')
    return due > 0n ? { label: 'Siap dibayar', tone: 'warning' } : { label: 'Siap ditutup', tone: 'brand' };
  return discharged ? { label: 'Belum final', tone: 'neutral' } : { label: 'Masih dirawat', tone: 'info' };
}

/** Uang tunai diterima vs sisa tagihan: kembalian atau kekurangan. */
export function cashChange(
  due: bigint,
  received: bigint,
): { enough: boolean; change: bigint; short: bigint } {
  return received >= due
    ? { enough: true, change: received - due, short: 0n }
    : { enough: false, change: 0n, short: due - received };
}

/**
 * Margin flat cicilan pasien BTN (% per tahun, simulasi). Sama dengan `instalmentMarginPercent` layar Pembiayaan
 * (dijaga tes); angsuran memakai rumus yang sama (`monthlyInstalment`).
 */
export const INSTALMENT_MARGIN_PERCENT = 11;
export const INSTALMENT_TENORS = [3, 6, 12] as const;

/** Pilihan tenor cicilan BTN dengan estimasi angsuran per bulan (simulasi; angka final ditetapkan BTN). */
export function instalmentOptions(principal: bigint): Array<{ id: string; label: string; sub: string }> {
  return INSTALMENT_TENORS.map((n) => ({
    id: String(n),
    label: `${n} bulan`,
    sub: `±${formatRupiah(monthlyInstalment(principal, n, INSTALMENT_MARGIN_PERCENT))}/bln`,
  }));
}

/** Alasan tertulis item manual: minimal sekian karakter (tercatat di jejak audit). */
export const MANUAL_REASON_MIN = 15;
export const MANUAL_PRICE_MAX = 100_000_000n;

export interface ManualLineInput {
  name: string;
  qty: number;
  unitPrice: bigint;
  reason: string;
}

/** Gerbang item manual: daftar masalah (kosong = boleh diajukan). Dipakai tombol klien dan Server Action. */
export function manualLineProblems(i: ManualLineInput): string[] {
  const problems: string[] = [];
  if (i.name.trim().length < 3) problems.push('isi nama item');
  if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 99) problems.push('kuantitas 1–99');
  if (i.unitPrice <= 0n || i.unitPrice > MANUAL_PRICE_MAX) problems.push('isi harga satuan');
  const short = MANUAL_REASON_MIN - i.reason.trim().length;
  if (short > 0) problems.push(`tulis alasan (min. ${MANUAL_REASON_MIN} karakter, ${short} lagi)`);
  return problems;
}

/** Kuantitas item manual: hanya bilangan bulat 1–99 tanpa desimal ("2.5" ditolak, bukan dipotong jadi 2). */
export function parseQty(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n : null;
}

/** Hanya digit (input nominal "1.250.400" → 1250400n); kosong → 0n. */
export function digitsToRupiah(input: string): bigint {
  const digits = input.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits ? BigInt(digits.slice(0, 15)) : 0n;
}

/** Ringkas untuk KPI: "Rp 7,82 M", "Rp 184 jt", "Rp 950 rb" (tiga angka penting, dibulatkan setengah ke atas). */
export function formatRupiahRingkas(v: bigint): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const units: Array<[bigint, string]> = [
    [1_000_000_000n, 'M'],
    [1_000_000n, 'jt'],
    [1_000n, 'rb'],
  ];
  const [base, unit] = units.find(([b]) => abs >= b) ?? [1n, ''];
  const whole = abs / base;
  const decimals = whole >= 100n ? 0 : whole >= 10n ? 1 : 2;
  const scale = 10n ** BigInt(decimals);
  const scaled = (abs * scale * 2n + base) / (base * 2n);
  const intPart = (scaled / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = decimals ? (scaled % scale).toString().padStart(decimals, '0').replace(/0+$/, '') : '';
  return `${neg ? '−' : ''}Rp ${intPart}${frac ? `,${frac}` : ''}${unit ? ` ${unit}` : ''}`;
}
