import { sumRupiah } from '@simrs/shared';
import {
  AKUN_LANJUT as A,
  type AkunRef,
  cr,
  type DrafJurnal,
  dr,
  jurnal,
  periodeTerkunci,
} from './keuangan-jurnal';

/**
 * U09 · Kas dan bank (mode presentasi, ADR-0023; rencana fase 5 potongan 5.7–5.8): kas harian kasir (buka laci,
 * hitung fisik per pecahan, selisih beralasan, setoran) dan mutasi bank BTN dengan pencocokan dasar (setoran kas,
 * settlement EDC + MDR, transfer penjamin, biaya bank), pengecualian bercatatan, dan lepas padanan dengan jurnal
 * balik. Mutasi periode tertutup terkunci. Murni; uang bigint.
 */

// ─── Kas kasir ────────────────────────────────────────────────────────────────────────────────────────────────

export const PECAHAN = [
  100_000n,
  50_000n,
  20_000n,
  10_000n,
  5_000n,
  2_000n,
  1_000n,
  500n,
  200n,
  100n,
] as const;

export interface TransaksiTunai {
  id: string;
  at: string;
  label: string;
  /** Positif = uang masuk laci (pembayaran tunai neto setelah kembalian); negatif = keluar (refund tunai). */
  amount: bigint;
}

export interface Laci {
  id: string;
  counter: string;
  cashier: string;
  status: 'buka' | 'tutup';
  openedAt: string | null;
  float: bigint;
  transactions: TransaksiTunai[];
  /** Penutupan terakhir (laci tutup). */
  lastClose?: { at: string; physical: bigint; expected: bigint; reason: string | null };
}

export function expectedCash(l: Pick<Laci, 'float' | 'transactions'>): bigint {
  return l.float + sumRupiah(l.transactions.map((t) => t.amount));
}

/** Jumlah fisik dari hitungan per pecahan (lembar/keping bilangan bulat ≥ 0). */
export function countTotal(counts: Readonly<Record<string, number>>): bigint {
  return sumRupiah(PECAHAN.map((d) => d * BigInt(Math.max(0, Math.trunc(counts[d.toString()] ?? 0)))));
}

export const SELISIH_REASON_MIN = 15;
/** Selisih di atas ambang ini wajib disaksikan supervisor kasir. */
export const SELISIH_SUPERVISOR = 50_000n;

export function closeProblems(
  physical: bigint,
  expected: bigint,
  reason: string,
  supervisorWitnessed: boolean,
): string[] {
  const diff = physical - expected;
  const out: string[] = [];
  if (physical <= 0n) out.push('isi hitungan fisik per pecahan');
  if (diff !== 0n) {
    const short = SELISIH_REASON_MIN - reason.trim().length;
    if (short > 0) out.push(`tulis alasan selisih (min. ${SELISIH_REASON_MIN} karakter, ${short} lagi)`);
    const abs = diff < 0n ? -diff : diff;
    if (abs > SELISIH_SUPERVISOR && !supervisorWitnessed)
      out.push('selisih di atas Rp 50.000 wajib disaksikan supervisor');
  }
  return out;
}

/**
 * Jurnal tutup laci dan setoran: setoran = fisik − modal laci (modal tetap di laci). Kurang: Dr Bank + Dr Beban
 * selisih / Cr Kas. Lebih: Dr Bank / Cr Kas + Cr Pendapatan lain.
 */
export function closeJournal(counter: string, physical: bigint, expected: bigint, float: bigint): DrafJurnal {
  const deposit = physical - float;
  const cashOut = expected - float;
  const diff = physical - expected;
  return jurnal(`Tutup laci ${counter} dan setoran`, [
    dr(A.bankOps, deposit),
    diff < 0n ? dr(A.bebanSelisihKas, -diff) : dr(A.bebanSelisihKas, 0n),
    cr(A.kasKasir, cashOut),
    diff > 0n ? cr(A.pendapatanLain, diff) : cr(A.pendapatanLain, 0n),
  ]);
}

// ─── Mutasi bank ──────────────────────────────────────────────────────────────────────────────────────────────

export type JenisPadanan = 'setoran' | 'edc' | 'penjamin' | 'biaya-bank';

export interface KandidatPadanan {
  id: string;
  kind: JenisPadanan;
  label: string;
  /** Nilai dokumen (bruto); untuk EDC = total transaksi sebelum MDR. */
  amount: bigint;
  /** EDC: beban MDR yang dipotong bank. */
  fee?: bigint;
  /** Akun lawan pencocokan (piutang EDC, piutang penjamin, beban adm). */
  account: AkunRef;
}

export interface MutasiBank {
  id: string;
  at: string;
  description: string;
  /** Positif = kredit rekening (uang masuk); negatif = debit (keluar). */
  amount: bigint;
  status: 'cocok' | 'belum' | 'pengecualian';
  matchedTo: string | null;
  note: string | null;
  candidates: KandidatPadanan[];
}

/** Kandidat cocok bila nominal mutasi = nilai dokumen − biaya (EDC) atau = nilai dokumen (tanda sesuai arah). */
export function candidateFits(m: Pick<MutasiBank, 'amount'>, c: KandidatPadanan): boolean {
  const net = c.amount - (c.fee ?? 0n);
  return c.kind === 'biaya-bank' ? m.amount === -c.amount : m.amount === net;
}

/** Jurnal saat cocok. Masuk: Dr Bank (+ Dr MDR) / Cr akun lawan. Keluar (biaya): Dr beban / Cr Bank. */
export function matchJournal(m: Pick<MutasiBank, 'amount' | 'description'>, c: KandidatPadanan): DrafJurnal {
  if (c.kind === 'biaya-bank') {
    return jurnal(`Padanan ${c.label}`, [dr(c.account, -m.amount), cr(A.bankOps, -m.amount)]);
  }
  return jurnal(`Padanan ${c.label}`, [
    dr(A.bankOps, m.amount),
    dr(A.bebanMdr, c.fee ?? 0n),
    cr(c.account, c.amount),
  ]);
}

/** Pengecualian: dana masuk tanpa dokumen dicatat sebagai titipan belum teridentifikasi (bukan pendapatan). */
export const TITIPAN: AkunRef = { code: '2-1290', name: 'Titipan dana belum teridentifikasi' };

export function exceptionJournal(m: Pick<MutasiBank, 'amount' | 'description'>): DrafJurnal {
  return m.amount >= 0n
    ? jurnal(`Pengecualian ${m.description}`, [dr(A.bankOps, m.amount), cr(TITIPAN, m.amount)])
    : jurnal(`Pengecualian ${m.description}`, [dr(TITIPAN, -m.amount), cr(A.bankOps, -m.amount)]);
}

/** Jurnal balik (lepas padanan): debit ↔ kredit ditukar, nilai sama. */
export function reverseJournal(j: DrafJurnal, memo: string): DrafJurnal {
  return jurnal(
    memo,
    j.lines
      .map((l) => ({ account: l.account, debit: l.credit, credit: l.debit }))
      // Debit dulu, seperti jurnal biasa.
      .sort((a, b) => Number(b.debit > 0n) - Number(a.debit > 0n)),
  );
}

export const PENGECUALIAN_NOTE_MIN = 10;

export function mutationLocked(m: Pick<MutasiBank, 'at'>, closed: readonly string[]): boolean {
  return periodeTerkunci(m.at, closed);
}

/** Ringkasan rekonsiliasi: saldo buku = saldo rekening koran − mutasi yang belum dipadankan/dikecualikan. */
export function reconSummary(
  statementBalance: bigint,
  mutations: readonly MutasiBank[],
): {
  open: number;
  openAmount: bigint;
  bookBalance: bigint;
} {
  const open = mutations.filter((m) => m.status === 'belum');
  const openAmount = sumRupiah(open.map((m) => m.amount));
  return { open: open.length, openAmount, bookBalance: statementBalance - openAmount };
}
