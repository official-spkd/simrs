import { type ChargeCategory, sumRupiah } from '@simrs/shared';
import { bagiSisaTerbesar, persen } from './keuangan-jurnal';

/**
 * U01 · Tarif dan paket (mode presentasi, ADR-0023): tarif berkomponen per kelas dan penjamin, versi berlaku mulai
 * tanggal, usulan perubahan dengan persetujuan (pembuat ≠ penyetuju, tidak retroaktif), paket tindakan. Murni;
 * uang bigint rupiah.
 */

export const KELAS_TARIF = [
  { id: 'k3', label: 'Kelas 3' },
  { id: 'k2', label: 'Kelas 2' },
  { id: 'k1', label: 'Kelas 1' },
  { id: 'vip', label: 'VIP' },
] as const;
export type KelasTarif = (typeof KELAS_TARIF)[number]['id'];
export type HargaKelas = Record<KelasTarif, bigint>;

export const KOMPONEN_TARIF = [
  { id: 'sarana', label: 'Jasa sarana' },
  { id: 'medis', label: 'Jasa medis' },
  { id: 'paramedis', label: 'Jasa paramedis' },
  { id: 'bhp', label: 'BHP' },
] as const;
export type KomponenTarif = (typeof KOMPONEN_TARIF)[number]['id'];

/** Penjamin: tarif kontrak = tarif dasar × (10.000 + bp) / 10.000, dibulatkan ke ratusan rupiah terdekat. */
export interface PenjaminTarif {
  id: 'umum' | 'asuransi' | 'perusahaan' | 'jkn';
  label: string;
  /** Penyesuaian basis poin terhadap tarif dasar (−500 = diskon 5%). */
  bp: number;
  note: string;
}

export interface VersiTarif {
  version: number;
  validFrom: string;
  /** Tanggal terakhir berlaku (inklusif); null = masih berlaku / terjadwal tanpa akhir. */
  validTo: string | null;
  prices: HargaKelas;
  approvedBy: string;
  approvedAt: string;
  note: string;
}

export interface ItemTarif {
  code: string;
  name: string;
  category: ChargeCategory;
  unit: string;
  /** Komposisi komponen dalam basis poin (Σ = 10.000). */
  composition: Record<KomponenTarif, number>;
  versions: VersiTarif[];
}

export type StatusUsulan = 'diajukan' | 'disetujui' | 'ditolak';

export interface UsulanTarif {
  id: string;
  number: string;
  itemCode: string;
  maker: string;
  makerRole: string;
  createdAt: string;
  validFrom: string;
  prices: HargaKelas;
  reason: string;
  status: StatusUsulan;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
}

export interface PaketTarif {
  id: string;
  code: string;
  name: string;
  /** Lama rawat yang dicakup paket (malam), 0 = rawat jalan/ODC. */
  maxLos: number;
  prices: HargaKelas;
  items: Array<{ itemCode: string; qty: number }>;
  exclusions: string[];
  validFrom: string;
}

export interface AturanNaikKelas {
  id: string;
  version: string;
  validFrom: string;
  label: string;
  rule: string;
}

/** Versi yang berlaku pada tanggal `date` (YYYY-MM-DD); undefined bila belum ada. */
export function activeVersion(item: Pick<ItemTarif, 'versions'>, date: string): VersiTarif | undefined {
  return item.versions.find((v) => v.validFrom <= date && (v.validTo === null || date <= v.validTo));
}

/** Versi terjadwal (berlaku setelah `date`). */
export function scheduledVersion(item: Pick<ItemTarif, 'versions'>, date: string): VersiTarif | undefined {
  return item.versions.find((v) => v.validFrom > date);
}

/** Rincian komponen satu harga; Σ komponen = harga tepat (sisa terbesar, bigint). */
export function componentSplit(
  price: bigint,
  composition: ItemTarif['composition'],
): Array<{ id: KomponenTarif; label: string; amount: bigint }> {
  const amounts = bagiSisaTerbesar(
    price,
    KOMPONEN_TARIF.map((k) => BigInt(composition[k.id])),
  );
  return KOMPONEN_TARIF.map((k, i) => ({ id: k.id, label: k.label, amount: amounts[i] ?? 0n }));
}

/** Tarif penjamin dari tarif dasar: bulat ke ratusan rupiah terdekat. */
export function payerPrice(base: bigint, bp: number): bigint {
  // base × (10.000 + bp) / 10.000, lalu dibulatkan ke 100 terdekat: satu pembagian bigint (tanpa float).
  const raw = base * BigInt(10_000 + bp);
  return ((raw + 500_000n) / 1_000_000n) * 100n;
}

/** "▲ 8,3%" / "▼ 2,0%" / "tetap". */
export function changeLabel(oldPrice: bigint, newPrice: bigint): string {
  if (oldPrice === newPrice) return 'tetap';
  const diff = newPrice - oldPrice;
  return `${diff > 0n ? '▲' : '▼'} ${persen(diff < 0n ? -diff : diff, oldPrice)}`;
}

export const USULAN_REASON_MIN = 15;
/** Kenaikan di atas ambang ini butuh lampiran analisis biaya (peringatan, bukan penolakan). */
export const KENAIKAN_PERLU_ANALISIS_BP = 2_000n;

/**
 * Gerbang usulan perubahan tarif (dipakai tombol klien): daftar masalah, kosong = boleh diajukan.
 * - harga semua kelas > 0 dan berjenjang (Kelas 3 ≤ Kelas 2 ≤ Kelas 1 ≤ VIP)
 * - berlaku mulai setelah hari ini (tidak retroaktif) dan tidak bertabrakan dengan versi terjadwal
 * - alasan tertulis ≥ 15 karakter
 * - ada perubahan dibanding versi berlaku
 */
export function usulanProblems(
  item: Pick<ItemTarif, 'versions'>,
  draft: { validFrom: string; prices: HargaKelas; reason: string },
  today: string,
): string[] {
  const problems: string[] = [];
  const p = draft.prices;
  if (KELAS_TARIF.some((k) => p[k.id] <= 0n)) problems.push('isi harga semua kelas');
  else if (!(p.k3 <= p.k2 && p.k2 <= p.k1 && p.k1 <= p.vip)) {
    problems.push('harga harus berjenjang: Kelas 3 ≤ Kelas 2 ≤ Kelas 1 ≤ VIP');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.validFrom)) problems.push('isi tanggal berlaku mulai');
  else if (draft.validFrom <= today) problems.push('berlaku mulai harus setelah hari ini (tidak retroaktif)');
  else if (item.versions.some((v) => v.validFrom === draft.validFrom || v.validFrom > today)) {
    problems.push('sudah ada versi terjadwal; batalkan atau tunggu versi itu berlaku');
  }
  const current = activeVersion(item, today);
  if (current && KELAS_TARIF.every((k) => current.prices[k.id] === p[k.id])) {
    problems.push('harga sama dengan versi berlaku');
  }
  const short = USULAN_REASON_MIN - draft.reason.trim().length;
  if (short > 0) problems.push(`tulis alasan (min. ${USULAN_REASON_MIN} karakter, ${short} lagi)`);
  return problems;
}

/** Kelas dengan kenaikan > 20% dari versi berlaku (perlu lampiran analisis biaya). */
export function bigIncreases(current: HargaKelas, next: HargaKelas): KelasTarif[] {
  return KELAS_TARIF.filter((k) => {
    const o = current[k.id];
    return o > 0n && (next[k.id] - o) * 10_000n > o * KENAIKAN_PERLU_ANALISIS_BP;
  }).map((k) => k.id);
}

/**
 * Persetujuan usulan: hanya posisi manajemen, pembuat ≠ penyetuju, usulan masih diajukan, dan tanggal berlaku
 * belum lewat. Null = boleh.
 */
export function approvalProblem(
  u: Pick<UsulanTarif, 'maker' | 'status' | 'validFrom'>,
  approver: { name: string; role: string | null },
  today: string,
): string | null {
  if (u.status !== 'diajukan') return 'Usulan sudah diputuskan.';
  if (approver.role !== 'manajemen')
    return 'Persetujuan tarif oleh posisi manajemen (direktur/manajer keuangan).';
  if (approver.name === u.maker) return 'Pembuat usulan tidak boleh menyetujui usulannya sendiri.';
  if (u.validFrom <= today) return 'Tanggal berlaku sudah lewat; ajukan ulang dengan tanggal baru.';
  return null;
}

/** Terapkan usulan yang disetujui: versi berlaku ditutup sehari sebelum versi baru, versi baru ditambahkan. */
export function applyApproved(item: ItemTarif, u: UsulanTarif, by: string, at: string): ItemTarif {
  const prevDay = shiftDay(u.validFrom, -1);
  const last = item.versions.reduce((m, v) => Math.max(m, v.version), 0);
  return {
    ...item,
    versions: [
      ...item.versions.map((v) => (v.validTo === null ? { ...v, validTo: prevDay } : v)),
      {
        version: last + 1,
        validFrom: u.validFrom,
        validTo: null,
        prices: u.prices,
        approvedBy: by,
        approvedAt: at,
        note: `${u.number}: ${u.reason}`,
      },
    ],
  };
}

function shiftDay(iso: string, days: number): string {
  const [y = 2026, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Paket: Σ tarif item satuan pada kelas itu vs harga paket. */
export function packageView(
  pkg: PaketTarif,
  items: readonly ItemTarif[],
  kelas: KelasTarif,
  date: string,
): {
  lines: Array<{ itemCode: string; name: string; qty: number; unit: bigint; amount: bigint }>;
  itemized: bigint;
  price: bigint;
  saving: bigint;
  savingLabel: string;
} {
  const lines = pkg.items.map((l) => {
    const item = items.find((i) => i.code === l.itemCode);
    const unit = (item && activeVersion(item, date)?.prices[kelas]) ?? 0n;
    return {
      itemCode: l.itemCode,
      name: item?.name ?? l.itemCode,
      qty: l.qty,
      unit,
      amount: unit * BigInt(l.qty),
    };
  });
  const itemized = sumRupiah(lines.map((l) => l.amount));
  const price = pkg.prices[kelas];
  return {
    lines,
    itemized,
    price,
    saving: itemized - price,
    savingLabel: persen(itemized - price, itemized),
  };
}

/** Parsing isian harga "1.250.000" → 1250000n; kosong/tak sah → 0n. */
export function parseHarga(input: string): bigint {
  const digits = input.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits ? BigInt(digits.slice(0, 12)) : 0n;
}
