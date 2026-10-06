import { sumRupiah } from '@simrs/shared';
import {
  AKUN_LANJUT as A,
  type AkunRef,
  cr,
  type DrafJurnal,
  dr,
  jurnal,
  periodeTerkunci,
  selisihHari,
} from './keuangan-jurnal';

/**
 * U04 · Penjaminan dan piutang (mode presentasi, ADR-0023): pembagian porsi penjamin vs pasien (BPJS + selisih naik
 * kelas berversi, asuransi berplafon, umum), umur piutang per penjamin, batch penagihan, pelunasan bereferensi, dan
 * penyesuaian beralasan berpersetujuan. Setiap mutasi uang membentuk jurnal berpasangan. Murni; uang bigint.
 */

// ─── Pembagian penjamin ──────────────────────────────────────────────────────────────────────────────────────

export type SkemaPenjamin = 'bpjs' | 'asuransi' | 'umum';
export type NaikKelas = 'tidak' | 'k1' | 'vip';

export interface PembagianInput {
  scheme: SkemaPenjamin;
  total: bigint;
  /** BPJS: tarif INA-CBG hak kelas dan Kelas 1 (untuk selisih naik kelas). */
  cbgHak?: bigint;
  cbgK1?: bigint;
  upgrade?: NaikKelas;
  /** Asuransi: plafon surat jaminan dan item di luar tanggungan. */
  plafon?: bigint;
  nonCovered?: bigint;
}

export interface Pembagian {
  total: bigint;
  payer: bigint;
  patient: bigint;
  /** BPJS: tarif RS − INA-CBG − selisih pasien (positif = ditanggung RS, negatif = surplus). */
  hospital: bigint;
  /** Selisih naik kelas (bagian dari porsi pasien). */
  upgradeAmount: bigint;
  /** Rincian dalam kalimat untuk layar. */
  basis: string[];
}

/** Persen batas selisih naik kelas di atas Kelas 1 (aturan berversi NK-2026-01, angka simulasi). */
export const VIP_CAP_PERCENT = 75n;

/** Selisih naik kelas JKN rawat inap per aturan berversi: ke Kelas 1 = CBG K1 − CBG hak; ke VIP = 75% CBG K1. */
export function selisihNaikKelas(upgrade: NaikKelas, cbgHak: bigint, cbgK1: bigint): bigint {
  if (upgrade === 'k1') return cbgK1 > cbgHak ? cbgK1 - cbgHak : 0n;
  if (upgrade === 'vip') return (cbgK1 * VIP_CAP_PERCENT) / 100n;
  return 0n;
}

/** Identitas pembagian: total = penjamin + pasien + ditanggung RS (selalu, dijaga tes). */
export function hitungPembagian(i: PembagianInput): Pembagian {
  if (i.scheme === 'bpjs') {
    const payer = i.cbgHak ?? 0n;
    const up = selisihNaikKelas(i.upgrade ?? 'tidak', payer, i.cbgK1 ?? payer);
    return {
      total: i.total,
      payer,
      patient: up,
      hospital: i.total - payer - up,
      upgradeAmount: up,
      basis: [
        'BPJS membayar tarif INA-CBG hak kelas (dicatat sebagai piutang BPJS)',
        up > 0n
          ? i.upgrade === 'vip'
            ? 'Pasien membayar selisih naik kelas VIP: 75% tarif INA-CBG Kelas 1'
            : 'Pasien membayar selisih naik kelas: INA-CBG Kelas 1 − INA-CBG hak kelas'
          : 'Tanpa naik kelas: pasien tidak membayar',
        'Selisih tarif RS dan INA-CBG ditanggung RS (pengurang pendapatan)',
      ],
    };
  }
  if (i.scheme === 'asuransi') {
    const non = i.nonCovered ?? 0n;
    const covered = i.total - non;
    const plafon = i.plafon ?? 0n;
    const payer = covered < plafon ? covered : plafon;
    return {
      total: i.total,
      payer,
      patient: i.total - payer,
      hospital: 0n,
      upgradeAmount: 0n,
      basis: [
        'Asuransi membayar sampai plafon surat jaminan',
        `Pasien membayar kelebihan plafon dan item di luar tanggungan`,
      ],
    };
  }
  return {
    total: i.total,
    payer: 0n,
    patient: i.total,
    hospital: 0n,
    upgradeAmount: 0n,
    basis: ['Pasien umum membayar seluruh tagihan'],
  };
}

const AKUN_PENGAKUAN = {
  piutangBpjs: { code: '1-1320', name: 'Piutang BPJS — RI' },
  selisihCbg: { code: '4-1900', name: 'Selisih tarif INA-CBG (pengurang pendapatan)' },
  pendapatanJkn: { code: '4-1200', name: 'Pendapatan RI — JKN' },
  pendapatanNonJkn: { code: '4-1300', name: 'Pendapatan layanan — non-JKN' },
} as const;

/**
 * Jurnal pengakuan saat tagihan final: piutang penjamin + porsi pasien (+ selisih INA-CBG ditanggung RS) = pendapatan
 * tarif RS. Surplus INA-CBG (RS menanggung negatif) dicatat di kredit akun selisih.
 */
export function recognitionJournal(scheme: SkemaPenjamin, s: Pembagian): DrafJurnal {
  const bpjs = scheme === 'bpjs';
  return jurnal('Pengakuan pendapatan saat tagihan final', [
    dr(bpjs ? AKUN_PENGAKUAN.piutangBpjs : A.piutangAsuransi, s.payer),
    dr(A.piutangPasien, s.patient),
    s.hospital >= 0n ? dr(AKUN_PENGAKUAN.selisihCbg, s.hospital) : cr(AKUN_PENGAKUAN.selisihCbg, -s.hospital),
    cr(bpjs ? AKUN_PENGAKUAN.pendapatanJkn : AKUN_PENGAKUAN.pendapatanNonJkn, s.total),
  ]);
}

// ─── Umur piutang, penagihan, pelunasan ──────────────────────────────────────────────────────────────────────

export type PenjaminPiutang = 'asuransi' | 'kerja-sama' | 'umum';

export interface PiutangItem {
  id: string;
  payerGroup: PenjaminPiutang;
  /** Nama penjamin (asuransi/perusahaan) atau "Pasien". */
  payerName: string;
  patient: string;
  invoiceNo: string;
  invoiceDate: string;
  amount: bigint;
  paid: bigint;
  /** Batch penagihan yang memuat item ini; null = belum ditagih. */
  batch: string | null;
}

export interface PembayaranPiutang {
  id: string;
  at: string;
  amount: bigint;
  reference: string;
}

export interface BatchTagihan {
  number: string;
  payerName: string;
  payerGroup: PenjaminPiutang;
  itemIds: string[];
  status: 'draf' | 'ditagih' | 'sebagian' | 'lunas';
  sentAt: string | null;
  payments: PembayaranPiutang[];
}

export const AGING_LABEL = ['0–30 hari', '31–60 hari', '61–90 hari', '> 90 hari'] as const;

/** Kelompok umur (0–3) dari tanggal invoice ke hari ini (tanggal WIB). */
export function agingBucket(invoiceDate: string, today: string): 0 | 1 | 2 | 3 {
  const d = selisihHari(invoiceDate, today);
  return d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3;
}

export const outstanding = (p: Pick<PiutangItem, 'amount' | 'paid'>): bigint => p.amount - p.paid;

export function batchTotal(b: Pick<BatchTagihan, 'itemIds'>, items: readonly PiutangItem[]): bigint {
  return sumRupiah(items.filter((i) => b.itemIds.includes(i.id)).map((i) => i.amount));
}

export function batchPaid(b: Pick<BatchTagihan, 'payments'>): bigint {
  return sumRupiah(b.payments.map((p) => p.amount));
}

/** Gerbang batch baru: item terpilih belum ditagih, satu penjamin, dan bukan piutang pasien umum. */
export function batchProblem(selected: readonly PiutangItem[]): string | null {
  if (selected.length === 0) return 'Centang piutang yang akan ditagih dulu.';
  if (selected.some((s) => s.batch)) return 'Ada piutang yang sudah masuk batch penagihan lain.';
  if (new Set(selected.map((s) => s.payerName)).size > 1) return 'Satu batch hanya untuk satu penjamin.';
  if (selected.some((s) => s.payerGroup === 'umum'))
    return 'Piutang pasien ditagih lewat Kasir, bukan batch.';
  return null;
}

/** Gerbang pelunasan bereferensi: nominal > 0, tidak melebihi sisa, referensi bank wajib. */
export function paymentProblem(remaining: bigint, amount: bigint, reference: string): string | null {
  if (amount <= 0n) return 'Isi nominal pelunasan.';
  if (amount > remaining)
    return 'Nominal melebihi sisa tagihan batch; lebih bayar dicatat sebagai titipan, bukan pelunasan.';
  if (reference.trim().length < 6) return 'Isi referensi mutasi bank (min. 6 karakter).';
  return null;
}

export function payerAccount(group: PenjaminPiutang): AkunRef {
  return group === 'asuransi'
    ? A.piutangAsuransi
    : group === 'kerja-sama'
      ? A.piutangPerusahaan
      : A.piutangPasien;
}

/** Jurnal pelunasan: Dr Bank BTN operasional / Cr Piutang penjamin. */
export function paymentJournal(b: Pick<BatchTagihan, 'number' | 'payerGroup'>, amount: bigint): DrafJurnal {
  return jurnal(`Pelunasan ${b.number}`, [dr(A.bankOps, amount), cr(payerAccount(b.payerGroup), amount)]);
}

/** Status batch setelah pembayaran. */
export function batchStatus(total: bigint, paid: bigint, sent: boolean): BatchTagihan['status'] {
  if (!sent) return 'draf';
  if (paid >= total) return 'lunas';
  return paid > 0n ? 'sebagian' : 'ditagih';
}

/** Alokasikan pelunasan batch ke piutang di dalamnya, urut invoice tertua dulu (FIFO). Σ alokasi = nominal. */
export function allocatePayment(
  items: readonly PiutangItem[],
  b: Pick<BatchTagihan, 'itemIds'>,
  amount: bigint,
): PiutangItem[] {
  let left = amount;
  const add = new Map<string, bigint>();
  const order = items
    .filter((i) => b.itemIds.includes(i.id))
    .sort((x, y) => x.invoiceDate.localeCompare(y.invoiceDate));
  for (const it of order) {
    if (left <= 0n) break;
    const take = outstanding(it) < left ? outstanding(it) : left;
    add.set(it.id, take);
    left -= take;
  }
  return items.map((i) => {
    const plus = add.get(i.id);
    return plus === undefined ? i : { ...i, paid: i.paid + plus };
  });
}

/** Pembayaran di periode tertutup tidak bisa diubah; koreksi lewat jurnal penyesuaian di periode berjalan. */
export function paymentLocked(p: Pick<PembayaranPiutang, 'at'>, closed: readonly string[]): boolean {
  return periodeTerkunci(p.at, closed);
}

// ─── Penyesuaian piutang ─────────────────────────────────────────────────────────────────────────────────────

export type JenisPenyesuaian = 'potongan' | 'hapus-buku';

export interface Penyesuaian {
  id: string;
  number: string;
  itemId: string;
  kind: JenisPenyesuaian;
  amount: bigint;
  reason: string;
  maker: string;
  createdAt: string;
  status: 'menunggu' | 'disetujui' | 'ditolak';
  decidedBy?: string;
  decidedAt?: string;
}

export const PENYESUAIAN_LABEL: Record<JenisPenyesuaian, string> = {
  potongan: 'Potongan kontrak / koreksi tagihan',
  'hapus-buku': 'Hapus buku piutang tak tertagih',
};
export const PENYESUAIAN_REASON_MIN = 20;

export function adjustmentProblems(
  item: Pick<PiutangItem, 'amount' | 'paid'> | undefined,
  amount: bigint,
  reason: string,
): string[] {
  const out: string[] = [];
  if (!item) out.push('pilih piutang');
  else if (amount <= 0n || amount > outstanding(item)) out.push('nominal 1 rupiah sampai sisa piutang');
  const short = PENYESUAIAN_REASON_MIN - reason.trim().length;
  if (short > 0) out.push(`tulis alasan (min. ${PENYESUAIAN_REASON_MIN} karakter, ${short} lagi)`);
  return out;
}

/** Persetujuan penyesuaian: posisi manajemen dan pembuat ≠ penyetuju. */
export function adjustmentApprovalProblem(
  a: Pick<Penyesuaian, 'maker' | 'status'>,
  approver: { name: string; role: string | null },
): string | null {
  if (a.status !== 'menunggu') return 'Penyesuaian sudah diputuskan.';
  if (approver.role !== 'manajemen')
    return 'Penyesuaian piutang disetujui posisi manajemen (manajer keuangan).';
  if (approver.name === a.maker) return 'Pembuat penyesuaian tidak boleh menyetujui sendiri.';
  return null;
}

/** Jurnal penyesuaian (bertanggal periode berjalan): Dr beban/potongan / Cr piutang penjamin. */
export function adjustmentJournal(
  a: Pick<Penyesuaian, 'number' | 'kind' | 'amount'>,
  group: PenjaminPiutang,
): DrafJurnal {
  const debitAccount = a.kind === 'hapus-buku' ? A.bebanPiutang : A.potonganPenjualan;
  return jurnal(`Penyesuaian ${a.number}`, [dr(debitAccount, a.amount), cr(payerAccount(group), a.amount)]);
}
