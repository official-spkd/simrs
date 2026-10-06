import { sumRupiah } from '@simrs/shared';
import { AKUN_LANJUT as A, bagiSisaTerbesar, cr, type DrafJurnal, dr, jurnal } from './keuangan-jurnal';

/**
 * U08 · Jasa pelayanan (mode presentasi, ADR-0023; rencana fase 5 potongan 5.9): komponen jasa (medis + paramedis)
 * dari tarif setiap tindakan dialokasikan ke PPA menurut aturan pembagian berversi. Klaim BPJS direalisasikan saat
 * dibayar dengan rasio INA-CBG dibayar ÷ tarif RS; belum dibayar = ditahan. Rekap → verifikasi → persetujuan
 * (pembuat ≠ penyetuju) → ekspor → bayar, masing-masing dengan jurnal. Murni; uang bigint.
 */

export interface PorsiAturan {
  id: 'pelaksana' | 'tim' | 'bersama' | 'manajemen';
  label: string;
  /** Basis poin (Σ = 10.000). */
  bp: number;
}

export interface AturanJaspel {
  version: string;
  validFrom: string;
  shares: PorsiAturan[];
  /** Tarif PPh 21 simulasi atas jasa (basis poin). */
  pphBp: number;
}

export interface TindakanJaspel {
  id: string;
  date: string;
  patient: string;
  service: string;
  payer: 'bpjs' | 'asuransi' | 'umum';
  /** Pelaksana (DPJP/operator, atau perawat/bidan untuk tindakan keperawatan). */
  ppa: string;
  team: string;
  /** Komponen jasa medis + paramedis dari tarif (bigint). */
  fee: bigint;
  /** BPJS: klaim dibayar? rasio = dibayar ÷ tarif RS berkas. */
  claim?: { paid: boolean; cbgPaid: bigint; hospitalTariff: bigint; number: string };
}

/** Jasa yang terealisasi: non-BPJS penuh; BPJS × rasio bila klaim dibayar, nol bila belum. */
export function realizedFee(t: TindakanJaspel): bigint {
  if (t.payer !== 'bpjs' || !t.claim) return t.fee;
  if (!t.claim.paid || t.claim.hospitalTariff <= 0n) return 0n;
  const cbg = t.claim.cbgPaid < t.claim.hospitalTariff ? t.claim.cbgPaid : t.claim.hospitalTariff;
  return (t.fee * cbg) / t.claim.hospitalTariff;
}

export interface BarisRekap {
  name: string;
  /** Porsi pelaksana + tim. */
  gross: bigint;
  pph: bigint;
  net: bigint;
  count: number;
}

export interface RekapJaspel {
  rows: BarisRekap[];
  /** Pos kebersamaan dan manajemen (dibagi per aturan internal di luar layar ini). */
  pools: Array<{ id: PorsiAturan['id']; label: string; amount: bigint }>;
  realized: bigint;
  held: bigint;
  totalGross: bigint;
  totalPph: bigint;
}

/** Alokasi per tindakan dengan sisa terbesar: Σ alokasi = jasa terealisasi tepat (dijaga tes). */
export function allocate(t: TindakanJaspel, rule: AturanJaspel): Record<PorsiAturan['id'], bigint> {
  const parts = bagiSisaTerbesar(
    realizedFee(t),
    rule.shares.map((s) => BigInt(s.bp)),
  );
  const out = { pelaksana: 0n, tim: 0n, bersama: 0n, manajemen: 0n };
  rule.shares.forEach((s, i) => {
    out[s.id] += parts[i] ?? 0n;
  });
  return out;
}

export function pphOf(gross: bigint, bp: number): bigint {
  return (gross * BigInt(bp)) / 10_000n;
}

export function rekap(list: readonly TindakanJaspel[], rule: AturanJaspel): RekapJaspel {
  const by = new Map<string, BarisRekap>();
  const add = (name: string, v: bigint) => {
    const r = by.get(name) ?? { name, gross: 0n, pph: 0n, net: 0n, count: 0 };
    r.gross += v;
    r.count += 1;
    by.set(name, r);
  };
  const pools = { bersama: 0n, manajemen: 0n };
  for (const t of list) {
    if (realizedFee(t) === 0n) continue;
    const a = allocate(t, rule);
    add(t.ppa, a.pelaksana);
    add(t.team, a.tim);
    pools.bersama += a.bersama;
    pools.manajemen += a.manajemen;
  }
  const rows = [...by.values()]
    .map((r) => {
      const pph = pphOf(r.gross, rule.pphBp);
      return { ...r, pph, net: r.gross - pph };
    })
    .sort((a, b) => (b.gross > a.gross ? 1 : b.gross < a.gross ? -1 : a.name.localeCompare(b.name)));
  const realized = sumRupiah(list.map(realizedFee));
  return {
    rows,
    pools: rule.shares
      .filter((s) => s.id === 'bersama' || s.id === 'manajemen')
      .map((s) => ({ id: s.id, label: s.label, amount: pools[s.id as 'bersama' | 'manajemen'] })),
    realized,
    held: sumRupiah(list.filter((t) => realizedFee(t) === 0n).map((t) => t.fee)),
    totalGross: sumRupiah(rows.map((r) => r.gross)),
    totalPph: sumRupiah(rows.map((r) => r.pph)),
  };
}

export type TahapJaspel = 'dihitung' | 'diverifikasi' | 'disetujui' | 'dibayar';
export const TAHAP_JASPEL: ReadonlyArray<{ id: TahapJaspel; label: string }> = [
  { id: 'dihitung', label: 'Dihitung' },
  { id: 'diverifikasi', label: 'Diverifikasi akuntan' },
  { id: 'disetujui', label: 'Disetujui manajemen' },
  { id: 'dibayar', label: 'Dibayar' },
];

/** Gerbang tahap berikut: verifikasi oleh akuntan; persetujuan oleh manajemen yang bukan pemverifikasi; bayar oleh akuntan. */
export function stepProblem(
  stage: TahapJaspel,
  viewer: { name: string; role: string | null },
  verifiedBy: string | null,
): string | null {
  if (stage === 'dihitung') return viewer.role === 'akuntan' ? null : 'Verifikasi rekap oleh posisi akuntan.';
  if (stage === 'diverifikasi') {
    if (viewer.role !== 'manajemen') return 'Persetujuan rekap oleh posisi manajemen.';
    return viewer.name === verifiedBy ? 'Pemverifikasi tidak boleh menyetujui rekap yang sama.' : null;
  }
  if (stage === 'disetujui')
    return viewer.role === 'akuntan' ? null : 'Pembayaran jasa diposting posisi akuntan.';
  return 'Rekap sudah dibayar.';
}

/** Jurnal akrual saat disetujui: Dr Beban jasa pelayanan / Cr Utang jasa pelayanan (bruto pelaksana + tim). */
export function accrualJournal(r: Pick<RekapJaspel, 'totalGross'>, period: string): DrafJurnal {
  return jurnal(`Akrual jasa pelayanan ${period}`, [
    dr(A.bebanJaspel, r.totalGross),
    cr(A.utangJaspel, r.totalGross),
  ]);
}

/** Jurnal pembayaran: Dr Utang jasa / Cr Bank mitra (neto) / Cr Utang PPh 21. */
export function paymentJournal(r: Pick<RekapJaspel, 'totalGross' | 'totalPph'>, period: string): DrafJurnal {
  return jurnal(`Pembayaran jasa pelayanan ${period}`, [
    dr(A.utangJaspel, r.totalGross),
    cr(A.bankMitra, r.totalGross - r.totalPph),
    cr(A.utangPph21, r.totalPph),
  ]);
}

/** Sel CSV aman: tanda kutip ganda di-escape, awalan rumus (= + - @ tab CR) diberi apostrof (anti formula injection). */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function rekapCsv(r: RekapJaspel): string {
  const head = ['PPA', 'Jumlah tindakan', 'Bruto', 'PPh 21', 'Neto'];
  const rows = r.rows.map((x) => [
    x.name,
    String(x.count),
    x.gross.toString(),
    x.pph.toString(),
    x.net.toString(),
  ]);
  return [head, ...rows].map((row) => row.map(csvCell).join(';')).join('\n');
}
