import { sumRupiah } from '@simrs/shared';
import { persen } from './keuangan-jurnal';

/**
 * I10 · Costing dan case-mix (mode presentasi, ADR-0023): biaya per kasus berbasis aktivitas (akomodasi, tindakan,
 * obat/BHP, penunjang, overhead teralokasi) dibanding tarif INA-CBG, margin per kelompok kasus dan per DPJP, dan
 * varians lama rawat terhadap clinical pathway. Murni; uang bigint, lama rawat dalam persepuluh hari (integer).
 */

export const KOMPONEN_BIAYA = [
  { id: 'akomodasi', label: 'Akomodasi' },
  { id: 'tindakan', label: 'Tindakan dan jasa' },
  { id: 'obat', label: 'Obat dan BHP' },
  { id: 'penunjang', label: 'Lab dan radiologi' },
  { id: 'overhead', label: 'Overhead teralokasi' },
] as const;
export type KomponenBiaya = (typeof KOMPONEN_BIAYA)[number]['id'];

export interface KasusCosting {
  id: string;
  cbg: { code: string; name: string; classLabel: string };
  group: string;
  dpjp: string;
  smf: string;
  cases: number;
  /** Rata-rata biaya per kasus per komponen. */
  cost: Record<KomponenBiaya, bigint>;
  /** Tarif INA-CBG per kasus (pendapatan klaim). */
  tariff: bigint;
  /** Lama rawat rata-rata dan sasaran clinical pathway, dalam persepuluh hari (58 = 5,8 hari). */
  losTenths: number;
  pathwayTenths: number;
}

export const unitCost = (k: Pick<KasusCosting, 'cost'>): bigint =>
  sumRupiah(KOMPONEN_BIAYA.map((c) => k.cost[c.id]));

export interface MarginView {
  key: string;
  label: string;
  sub: string;
  cases: number;
  revenue: bigint;
  cost: bigint;
  margin: bigint;
  marginPct: string;
  perCase: bigint;
}

function view(key: string, label: string, sub: string, rows: readonly KasusCosting[]): MarginView {
  const cases = rows.reduce((s, r) => s + r.cases, 0);
  const revenue = sumRupiah(rows.map((r) => r.tariff * BigInt(r.cases)));
  const cost = sumRupiah(rows.map((r) => unitCost(r) * BigInt(r.cases)));
  const margin = revenue - cost;
  return {
    key,
    label,
    sub,
    cases,
    revenue,
    cost,
    margin,
    marginPct: persen(margin, revenue),
    perCase: cases ? margin / BigInt(cases) : 0n,
  };
}

/** Margin per kelompok kasus (kode INA-CBG + kelas) atau per DPJP; diurut dari margin terburuk. */
export function marginBy(rows: readonly KasusCosting[], by: 'cbg' | 'dpjp'): MarginView[] {
  const groups = new Map<string, KasusCosting[]>();
  for (const r of rows) {
    const k = by === 'cbg' ? `${r.cbg.code} ${r.cbg.classLabel}` : r.dpjp;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([k, list]) => {
      const first = list[0];
      return by === 'cbg'
        ? view(
            k,
            `${first?.cbg.code} · ${first?.cbg.name}`,
            `${first?.cbg.classLabel} · ${list.map((l) => l.dpjp).join(', ')}`,
            list,
          )
        : view(k, k, `${first?.smf} · ${list.map((l) => l.cbg.code).join(', ')}`, list);
    })
    .sort((a, b) => (a.margin < b.margin ? -1 : a.margin > b.margin ? 1 : a.key.localeCompare(b.key)));
}

export function totalView(rows: readonly KasusCosting[]): MarginView {
  return view('total', 'Semua kasus', '', rows);
}

/** Porsi komponen biaya (persen bulat, sisa terbesar → Σ = 100) untuk batang komposisi. */
export function costShares(
  k: Pick<KasusCosting, 'cost'>,
): Array<{ id: KomponenBiaya; label: string; amount: bigint; pct: number }> {
  const total = unitCost(k);
  const raw = KOMPONEN_BIAYA.map((c) => ({ ...c, amount: k.cost[c.id] }));
  if (total === 0n) return raw.map((r) => ({ ...r, pct: 0 }));
  const floors = raw.map((r) => ({ f: Number((r.amount * 100n) / total), rem: (r.amount * 100n) % total }));
  let left = 100 - floors.reduce((s, x) => s + x.f, 0);
  const order = floors
    .map((x, i) => ({ i, rem: x.rem }))
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  const pct = floors.map((x) => x.f);
  for (const o of order) {
    if (left <= 0) break;
    pct[o.i] = (pct[o.i] ?? 0) + 1;
    left -= 1;
  }
  return raw.map((r, i) => ({ ...r, pct: pct[i] ?? 0 }));
}

/** "5,8 hari". */
export const hari = (tenths: number): string => `${Math.trunc(tenths / 10)},${tenths % 10} hari`;

/**
 * Varians clinical pathway: kelebihan lama rawat × biaya akomodasi per hari menjadi perkiraan biaya yang bisa
 * dihindari per kasus (bigint). Null bila lama rawat sesuai pathway.
 */
export function losVariance(
  k: KasusCosting,
): { extraTenths: number; avoidablePerCase: bigint; text: string } | null {
  const extra = k.losTenths - k.pathwayTenths;
  if (extra <= 0) return null;
  const perDay = (k.cost.akomodasi * 10n) / BigInt(k.losTenths);
  const avoidable = (perDay * BigInt(extra)) / 10n;
  return {
    extraTenths: extra,
    avoidablePerCase: avoidable,
    text: `Lama rawat ${hari(k.losTenths)} vs pathway ${hari(k.pathwayTenths)}`,
  };
}

export const TELAAH_REASON_MIN = 20;
