import type { DashboardKpi, ExecutiveDashboard } from '@simrs/shared';

/** Format dan perhitungan tampilan Dasbor direksi (murni; data dari `lib/server/data/dashboard.ts`). */

const num = (v: number, digits = 1) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);

export function formatKpiValue(k: Pick<DashboardKpi, 'value' | 'unit'>): string {
  switch (k.unit) {
    case 'persen':
      return `${num(k.value)}%`;
    case 'hari':
      return `${num(k.value)} hari`;
    case 'menit':
      return `${num(k.value, 0)} mnt`;
    case 'pasien':
      return num(k.value, 0);
  }
}

/** "▲ 1 poin vs kemarin", "▼ 5 mnt vs kemarin", "tetap vs Sep". */
export function formatKpiDelta(k: Pick<DashboardKpi, 'delta' | 'deltaUnit' | 'comparedTo'>): string {
  if (k.delta === 0) return `tetap ${k.comparedTo}`;
  const abs = Math.abs(k.delta);
  const amount = {
    poin: `${num(abs)} poin`,
    hari: `${num(abs)} hari`,
    persen: `${num(abs)}%`,
    menit: `${num(abs, 0)} mnt`,
  }[k.deltaUnit];
  return `${k.delta > 0 ? '▲' : '▼'} ${amount} ${k.comparedTo}`;
}

/** Di dalam rentang sasaran (inklusif)? */
export function kpiOnTrack(k: Pick<DashboardKpi, 'value' | 'target'>): boolean {
  return (
    (k.target.min === undefined || k.value >= k.target.min) &&
    (k.target.max === undefined || k.value <= k.target.max)
  );
}

const juta = (rupiah: string) => Number(BigInt(rupiah) / 1_000_000n);
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const tanggalPendek = (iso: string) => {
  const [, m = 1, d = 1] = iso.split('-').map(Number);
  return `${d} ${BULAN[m - 1]}`;
};

export interface RevenueChart {
  actual: number[];
  budget: number[];
  /** Realisasi terhadap anggaran berjalan (persen, dibulatkan). */
  realizationPercent: number;
  xLabels: Array<{ index: number; label: string }>;
  rows: Array<{ date: string; actual: number; budget: number }>;
}

/** Deret pendapatan (Rp juta) + persentase realisasi = Σ realisasi / Σ anggaran. */
export function revenueChart(revenue: ExecutiveDashboard['revenue']): RevenueChart {
  const actual = revenue.map((r) => juta(r.actual));
  const budget = revenue.map((r) => juta(r.budget));
  const sumA = revenue.reduce((a, r) => a + BigInt(r.actual), 0n);
  const sumB = revenue.reduce((a, r) => a + BigInt(r.budget), 0n);
  const last = revenue.length - 1;
  const mid = Math.floor(last / 2);
  return {
    actual,
    budget,
    realizationPercent: sumB === 0n ? 0 : Number((sumA * 100n + sumB / 2n) / sumB),
    xLabels: [0, mid, last].map((i) => ({ index: i, label: tanggalPendek(revenue[i]?.date ?? '') })),
    rows: revenue.map((r, i) => ({
      date: tanggalPendek(r.date),
      actual: actual[i] ?? 0,
      budget: budget[i] ?? 0,
    })),
  };
}

/** Bauran penjamin: porsi pendapatan (persen bulat) + teks margin bertanda. */
export function payerShares(mix: ExecutiveDashboard['payerMix']) {
  const total = mix.reduce((a, m) => a + BigInt(m.revenue), 0n);
  return mix.map((m) => ({
    payer: m.payer,
    label: m.label,
    share: total === 0n ? 0 : Number((BigInt(m.revenue) * 100n + total / 2n) / total),
    margin: `${m.marginPercent < 0 ? '−' : '+'}${num(Math.abs(m.marginPercent))}%`,
    marginNegative: m.marginPercent < 0,
  }));
}

/** Kapasitas: persen terpakai; ≥ 90% ditandai merah. */
export function capacityRows(cap: ExecutiveDashboard['capacity']) {
  return cap.map((c) => {
    const percent = Math.round((c.used / c.total) * 100);
    return {
      id: c.id,
      label: c.label,
      text: `${c.used}/${c.total}${c.unit === 'kasus' ? ' kasus' : ''}`,
      percent,
      high: percent >= 90,
    };
  });
}

export const PERIOD_TITLES = {
  'hari-ini': 'Kinerja rumah sakit · hari ini',
  bulan: 'Kinerja rumah sakit · Oktober 2026',
  ytd: 'Kinerja rumah sakit · Januari–Oktober 2026',
} as const;
