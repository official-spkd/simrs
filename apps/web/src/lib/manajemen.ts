import {
  type DlqMessage,
  type IncidentReport,
  INTERFACE_IDS,
  type InterfaceId,
  type InventoryItem,
  type ProcurementChannel,
  type PurchaseOrderDraft,
  type QualityIndicator,
  type RiskEntry,
  type RiskLevel,
  sumRupiah,
} from '@simrs/shared';
import { logKind } from './demo/engine/format';
import type { LogEntry } from './demo/engine/types';

/**
 * Fungsi murni tampilan domain manajemen (integrasi, logistik, mutu). Data dari
 * `lib/server/data/manajemen.ts`; tidak ada efek samping di sini sehingga mudah diuji.
 */

const num = (v: number, digits = 1) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);

export const formatNumber = (v: number) => num(v, 0);

// ─── Integrasi ─────────────────────────────────────────────────────────────────────────────────────────────

/** Antarmuka tujuan sebuah baris jejak skenario (label sistem → kartu antarmuka), null = bukan pesan keluar. */
export function interfaceOfLog(entry: Pick<LogEntry, 'sys' | 'text'>): InterfaceId | null {
  const sys = entry.sys;
  switch (logKind(sys)) {
    case 'satusehat':
      return 'satusehat';
    case 'bpjs':
      if (sys.startsWith('BPJS Antrean')) return 'bpjs-antrean';
      if (sys.startsWith('E-Klaim') || /klaim/i.test(sys)) return 'eklaim';
      return 'bpjs-vclaim';
    case 'pembayaran':
      return sys.startsWith('TPDI') ? 'tpdi' : 'btn-h2h';
    case 'internal':
      if (sys.startsWith('LIS')) return 'lis';
      if (/notifikasi/i.test(entry.text)) return 'notifikasi';
      return null;
    case 'keselamatan':
      return null;
  }
}

/** Jumlah pesan keluar per antarmuka dari jejak skenario (semua skenario digabung pemanggil). */
export function countInterfaceLogs(
  logs: Iterable<Pick<LogEntry, 'sys' | 'text'>>,
): Record<InterfaceId, number> {
  const out = Object.fromEntries(INTERFACE_IDS.map((id) => [id, 0])) as Record<InterfaceId, number>;
  for (const l of logs) {
    const id = interfaceOfLog(l);
    if (id) out[id] += 1;
  }
  return out;
}

/** Label jam untuk indeks deret 24 jam (indeks 23 = jam berjalan, mis. "10.00"). */
export function hourLabel(index: number, currentHour = 10): string {
  const h = (((currentHour - 23 + index) % 24) + 24) % 24;
  return `${String(h).padStart(2, '0')}.00`;
}

/** Latensi p95 tampil: "820 ms", "1,2 dtk", atau "—" bila tidak terukur. */
export function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  return ms >= 1000 ? `${num(ms / 1000)} dtk` : `${ms} ms`;
}

/** Penampil payload galat: baris transport, pengenal, dan galat (tanpa data pribadi). */
export function dlqPayloadText(m: DlqMessage): string {
  return [
    m.request,
    ...Object.entries(m.payload).map(([k, v]) => `${k}: ${v}`),
    `galat: ${m.errorCode} · ${m.errorMessage}`,
    `percobaan: ${m.attempts}/${m.maxAttempts}`,
  ].join('\n');
}

// ─── Logistik ──────────────────────────────────────────────────────────────────────────────────────────────

/** Hari cukup di bawah ini ditandai kritis (enoksaparin < 7 hari di Dasbor direksi). */
export const CRITICAL_COVER_DAYS = 7;

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** ROP = pemakaian harian rata-rata × lead time + stok pengaman, dibulatkan ke atas. */
export function reorderPoint(i: Pick<InventoryItem, 'avgDailyUse' | 'leadTimeDays' | 'safetyStock'>): number {
  return Math.ceil(round6(i.avgDailyUse * i.leadTimeDays + i.safetyStock));
}

/** Stok cukup untuk sekian hari (1 desimal, dibulatkan ke bawah agar tidak optimistis). */
export function daysOfCover(stock: number, avgDailyUse: number): number {
  return Math.floor(round6((stock / avgDailyUse) * 10)) / 10;
}

export function needsReorder(i: Pick<InventoryItem, 'stock' | 'reorderPoint'>): boolean {
  return i.stock <= i.reorderPoint;
}

export function coverLevel(days: number): 'kritis' | 'perhatian' {
  return days < CRITICAL_COVER_DAYS ? 'kritis' : 'perhatian';
}

export function formatDays(days: number): string {
  return `${num(days)} hari`;
}

export const CHANNEL_LABEL: Record<ProcurementChannel, string> = {
  'e-katalog': 'e-katalog',
  'po-distributor': 'PO distributor',
  kso: 'kontrak KSO',
  'po-darurat': 'PO darurat',
};

/** Draf usulan PO dari item terpilih (urutan tabel); total = jumlah subtotal bigint. */
export function buildPoDraft(
  items: readonly InventoryItem[],
  selected: ReadonlySet<string>,
  number: string,
): PurchaseOrderDraft | null {
  const picked = items.filter((i) => selected.has(i.id));
  if (picked.length === 0) return null;
  const lines = picked.map((i) => ({
    itemId: i.id,
    name: i.name,
    kfa: i.kfa,
    qty: i.suggestedQty,
    unit: i.unit,
    unitPrice: i.unitPrice,
    subtotal: (BigInt(i.unitPrice) * BigInt(i.suggestedQty)).toString(),
    channel: i.channel,
    supplier: i.supplier,
  }));
  return {
    number,
    lines,
    total: sumRupiah(lines.map((l) => BigInt(l.subtotal))).toString(),
    urgent: picked.some((i) => i.channel === 'po-darurat' || i.daysOfCover < CRITICAL_COVER_DAYS),
  };
}

/** Rupiah ringkas untuk kartu: "Rp 4,82 M", "Rp 41,4 jt", "Rp 850 rb". */
export function formatRupiahShort(rupiah: bigint): string {
  const n = Number(rupiah);
  if (n >= 1e9) return `Rp ${num(n / 1e9, 2)} M`;
  if (n >= 1e6) return `Rp ${num(n / 1e6)} jt`;
  if (n >= 1e3) return `Rp ${num(n / 1e3, 0)} rb`;
  return `Rp ${n}`;
}

// ─── Mutu ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Capaian di dalam sasaran (inklusif; `min` = ≥, `max` = ≤)? */
export function indicatorOnTarget(q: Pick<QualityIndicator, 'value' | 'target'>): boolean {
  return (
    (q.target.min === undefined || q.value >= q.target.min) &&
    (q.target.max === undefined || q.value <= q.target.max)
  );
}

export function formatPercent(v: number): string {
  return `${num(v)}%`;
}

/** Arah tren bulan terakhir vs bulan sebelumnya. */
export function trendDirection(trend: readonly number[]): 'naik' | 'turun' | 'tetap' {
  const last = trend.at(-1) ?? 0;
  const prev = trend.at(-2) ?? last;
  if (last > prev) return 'naik';
  if (last < prev) return 'turun';
  return 'tetap';
}

export function riskScore(r: Pick<RiskEntry, 'likelihood' | 'impact'>): number {
  return r.likelihood * r.impact;
}

/** Pita matriks risiko 5×5: 1–3 rendah, 4–6 sedang, 8–12 tinggi, 15–25 ekstrem. */
export function riskLevel(score: number): RiskLevel {
  if (score >= 15) return 'ekstrem';
  if (score >= 8) return 'tinggi';
  if (score >= 4) return 'sedang';
  return 'rendah';
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  rendah: 'Rendah',
  sedang: 'Sedang',
  tinggi: 'Tinggi',
  ekstrem: 'Ekstrem',
};

/** Sel matriks (kemungkinan × dampak) beserta id risiko di sel itu. */
export function riskMatrix(risks: readonly RiskEntry[]): Array<{
  likelihood: number;
  impact: number;
  level: RiskLevel;
  ids: string[];
}> {
  const cells = [];
  for (let l = 5; l >= 1; l--) {
    for (let i = 1; i <= 5; i++) {
      cells.push({
        likelihood: l,
        impact: i,
        level: riskLevel(l * i),
        ids: risks.filter((r) => r.likelihood === l && r.impact === i).map((r) => r.id),
      });
    }
  }
  return cells;
}

export const GRADE_LABEL: Record<IncidentReport['grade'], string> = {
  biru: 'Biru · rendah',
  hijau: 'Hijau · sedang',
  kuning: 'Kuning · tinggi',
  merah: 'Merah · ekstrem',
};

export const INVESTIGATION_LABEL: Record<IncidentReport['investigation'], string> = {
  'belum-dimulai': 'Belum dimulai',
  'investigasi-sederhana': 'Investigasi sederhana',
  rca: 'RCA berjalan',
  selesai: 'Selesai',
};

export const INCIDENT_TYPE_LABEL: Record<IncidentReport['type'], string> = {
  KTD: 'KTD · kejadian tidak diharapkan',
  KNC: 'KNC · kejadian nyaris cedera',
  KTC: 'KTC · kejadian tidak cedera',
  KPC: 'KPC · kondisi potensial cedera',
  Sentinel: 'Sentinel',
};

/** Selisih hari kalender dari `today` ke `iso` (YYYY-MM-DD). */
export function daysUntil(iso: string, today: string): number {
  const t = (s: string) => {
    const [y = 1970, m = 1, d = 1] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(iso) - t(today)) / 86_400_000);
}
