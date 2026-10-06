import { sumRupiah } from '@simrs/shared';
import {
  AKUN_LANJUT as A,
  cr,
  type DrafJurnal,
  dr,
  jurnal,
  periodeTerkunci,
  selisihHari,
} from './keuangan-jurnal';

/**
 * U10 · Hutang usaha (mode presentasi, ADR-0023; rencana fase 5 potongan 5.8): faktur pemasok dari penerimaan
 * barang dengan pencocokan 3 arah (PO ↔ penerimaan ↔ faktur), verifikasi akuntan, persetujuan berjenjang menurut
 * nilai (pembuat ≠ penyetuju, tingkat 2 ≠ tingkat 1), jatuh tempo, dan jadwal bayar dengan jurnal. Murni; bigint.
 */

export type StatusFaktur = 'draf' | 'diverifikasi' | 'disetujui' | 'terjadwal' | 'dibayar';

export interface Persetujuan {
  level: 1 | 2;
  by: string;
  /** Id pengguna sesi (toko demo); data contoh tanpa id dibandingkan dengan nama. */
  byId?: string;
  at: string;
}

export interface FakturPemasok {
  id: string;
  invoiceNo: string;
  supplier: string;
  poNumber: string;
  grnNumber: string;
  title: string;
  receivedAt: string;
  invoiceDate: string;
  dueDate: string;
  poAmount: bigint;
  /** Nilai barang diterima × harga PO. */
  grnAmount: bigint;
  invoiceAmount: bigint;
  status: StatusFaktur;
  verifiedBy: string | null;
  verifiedById?: string | null;
  approvals: Persetujuan[];
  /** Selisih faktur vs penerimaan diterima dengan alasan (bila ada). */
  varianceNote: string | null;
  paidAt: string | null;
  paymentBatch: string | null;
}

export const STATUS_FAKTUR_LABEL: Record<StatusFaktur, string> = {
  draf: 'Draf dari penerimaan',
  diverifikasi: 'Diverifikasi · menunggu persetujuan',
  disetujui: 'Disetujui · siap dijadwalkan',
  terjadwal: 'Terjadwal bayar',
  dibayar: 'Dibayar',
};

/** Faktur di atas ambang ini butuh persetujuan tingkat 2 (direktur). */
export const AMBANG_TINGKAT_2 = 50_000_000n;

export function requiredLevels(f: Pick<FakturPemasok, 'invoiceAmount'>): 1 | 2 {
  return f.invoiceAmount > AMBANG_TINGKAT_2 ? 2 : 1;
}

export interface Pencocokan3Arah {
  ok: boolean;
  variance: bigint;
  overPo: boolean;
  text: string;
}

/** PO ↔ penerimaan ↔ faktur: faktur harus sama dengan nilai penerimaan, dan penerimaan tidak melebihi PO. */
export function threeWay(
  f: Pick<FakturPemasok, 'poAmount' | 'grnAmount' | 'invoiceAmount'>,
): Pencocokan3Arah {
  const variance = f.invoiceAmount - f.grnAmount;
  const overPo = f.grnAmount > f.poAmount;
  const ok = variance === 0n && !overPo;
  return {
    ok,
    variance,
    overPo,
    text: overPo
      ? 'Penerimaan melebihi PO'
      : variance === 0n
        ? 'PO, penerimaan, dan faktur cocok'
        : `Faktur ${variance > 0n ? 'lebih' : 'kurang'} dari penerimaan`,
  };
}

/** Gerbang verifikasi akuntan: draf, cocok 3 arah atau selisih diterima beralasan. */
export function verifyProblem(f: FakturPemasok, viewer: { role: string | null }): string | null {
  if (f.status !== 'draf') return 'Faktur sudah diverifikasi.';
  if (viewer.role !== 'akuntan') return 'Verifikasi faktur oleh posisi akuntan.';
  const m = threeWay(f);
  if (m.overPo) return 'Penerimaan melebihi PO; selesaikan dengan logistik dulu.';
  if (!m.ok && !f.varianceNote)
    return 'Selesaikan selisih faktur: minta nota kredit atau terima dengan alasan.';
  return null;
}

/** Gerbang persetujuan berjenjang: manajemen, bukan pemverifikasi, tingkat 2 oleh orang berbeda dari tingkat 1. */
export function approveProblem(
  f: FakturPemasok,
  viewer: { id?: string; name: string; role: string | null },
): string | null {
  if (f.status !== 'diverifikasi')
    return f.status === 'draf' ? 'Faktur belum diverifikasi akuntan.' : 'Faktur sudah disetujui.';
  if (viewer.role !== 'manajemen') return 'Persetujuan faktur oleh posisi manajemen.';
  const same = (byId: string | null | undefined, name: string | null) =>
    byId && viewer.id ? byId === viewer.id : name === viewer.name;
  if (same(f.verifiedById, f.verifiedBy)) return 'Pemverifikasi tidak boleh menyetujui faktur yang sama.';
  if (f.approvals.some((a) => same(a.byId, a.by))) {
    return 'Persetujuan tingkat 2 harus oleh orang yang berbeda dari tingkat 1.';
  }
  return null;
}

/** Terapkan persetujuan; status menjadi disetujui setelah semua tingkat terpenuhi. */
export function applyApproval(f: FakturPemasok, by: string, at: string, byId?: string): FakturPemasok {
  const level = (f.approvals.length + 1) as 1 | 2;
  const approvals = [...f.approvals, { level, by, at, ...(byId ? { byId } : {}) }];
  return { ...f, approvals, status: approvals.length >= requiredLevels(f) ? 'disetujui' : 'diverifikasi' };
}

/**
 * Jurnal saat faktur disetujui: Dr Utang penerimaan belum difakturkan (nilai penerimaan) + Dr/Cr Persediaan
 * (selisih harga diterima) / Cr Utang usaha (nilai faktur).
 */
export function approvalJournal(f: FakturPemasok): DrafJurnal {
  const v = f.invoiceAmount - f.grnAmount;
  return jurnal(`Faktur ${f.invoiceNo} ${f.supplier}`, [
    dr(A.utangBelumFaktur, f.grnAmount),
    v > 0n ? dr(A.persediaan, v) : dr(A.persediaan, 0n),
    v < 0n ? cr(A.persediaan, -v) : cr(A.persediaan, 0n),
    cr(A.utangUsaha, f.invoiceAmount),
  ]);
}

/** Jurnal pembayaran batch: Dr Utang usaha / Cr Bank mitra. */
export function paymentJournal(batch: string, total: bigint): DrafJurnal {
  return jurnal(`Pembayaran ${batch}`, [dr(A.utangUsaha, total), cr(A.bankMitra, total)]);
}

export type KelompokTempo = 'lewat' | 'minggu-ini' | 'bulan-ini' | 'nanti';
export const TEMPO_LABEL: Record<KelompokTempo, string> = {
  lewat: 'Lewat jatuh tempo',
  'minggu-ini': 'Jatuh tempo ≤ 7 hari',
  'bulan-ini': '8–30 hari',
  nanti: '> 30 hari',
};

export function dueGroup(dueDate: string, today: string): KelompokTempo {
  const d = selisihHari(today, dueDate);
  return d < 0 ? 'lewat' : d <= 7 ? 'minggu-ini' : d <= 30 ? 'bulan-ini' : 'nanti';
}

export function openAmount(list: readonly FakturPemasok[]): bigint {
  return sumRupiah(list.filter((f) => f.status !== 'dibayar').map((f) => f.invoiceAmount));
}

/** Gerbang jadwal bayar: faktur disetujui, saldo bank mitra cukup. */
export function scheduleProblem(selected: readonly FakturPemasok[], bankBalance: bigint): string | null {
  if (selected.length === 0) return 'Centang faktur yang disetujui untuk dijadwalkan.';
  if (selected.some((f) => f.status !== 'disetujui'))
    return 'Hanya faktur berstatus disetujui yang bisa dijadwalkan.';
  const total = sumRupiah(selected.map((f) => f.invoiceAmount));
  if (total > bankBalance) return 'Saldo bank mitra tidak cukup untuk batch ini.';
  return null;
}

export function invoiceLocked(f: Pick<FakturPemasok, 'paidAt'>, closed: readonly string[]): boolean {
  return !!f.paidAt && periodeTerkunci(f.paidAt, closed);
}
