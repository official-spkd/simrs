import type { ClinicalResult, EwsObservation } from '@simrs/shared';
import { ewsLevel, ewsMaxParam } from './rawat-inap';

/**
 * K14 · Ringkasan pasien satu layar: identitas, flag risiko, alergi, problem aktif, obat aktif, hasil terbaru (kritis
 * di atas), tanda vital + EWS terakhir, kunjungan terakhir. Logika murni penyusunan; data dari bagan RME.
 */

export interface SummaryMed {
  name: string;
  sig: string;
  highAlert: boolean;
}

export interface SummaryVisit {
  date: string;
  kind: string;
  unit: string;
  doctor: string;
  note: string;
}

export interface RiskFlag {
  label: string;
  tone: 'danger' | 'warning' | 'info';
}

const FLAG_RANK: Record<ClinicalResult['flag'], number> = { kritis: 0, tinggi: 1, rendah: 1, normal: 2 };

/** Hasil terbaru: nilai kritis selalu di atas, lalu terbaru; satu baris per pemeriksaan (nilai terakhir). */
export function latestResults(results: readonly ClinicalResult[], limit = 6): ClinicalResult[] {
  const byName = new Map<string, ClinicalResult>();
  for (const r of [...results].sort((a, b) => b.at.localeCompare(a.at)))
    if (!byName.has(r.name)) byName.set(r.name, r);
  return [...byName.values()]
    .sort((a, b) => FLAG_RANK[a.flag] - FLAG_RANK[b.flag] || b.at.localeCompare(a.at))
    .slice(0, limit);
}

/** Tanda vital terakhir dengan tingkat EWS bertulisan. */
export function lastVitals(
  obs: readonly EwsObservation[],
): (EwsObservation & { level: string; action: string }) | null {
  const last = [...obs].sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!last) return null;
  const lv = ewsLevel(last.score, ewsMaxParam(last));
  return { ...last, level: lv.level, action: lv.action };
}

/** Flag risiko: alergi, nilai kritis belum ditindaklanjuti, EWS, risiko tercatat, dan penanda rawat inap. */
export function riskFlags(a: {
  allergies: readonly string[];
  results: readonly ClinicalResult[];
  ewsLevel: string | null;
  risk: string | null;
  flags: readonly string[];
}): RiskFlag[] {
  const out: RiskFlag[] = [];
  if (a.allergies.length) out.push({ label: `Alergi ${a.allergies.join(', ')}`, tone: 'danger' });
  const crit = a.results.filter((r) => r.flag === 'kritis');
  for (const r of crit) out.push({ label: `Nilai kritis: ${r.name} ${r.value}`, tone: 'danger' });
  if (a.ewsLevel && a.ewsLevel !== 'rendah') out.push({ label: `EWS ${a.ewsLevel}`, tone: 'warning' });
  if (a.risk) out.push({ label: a.risk, tone: 'warning' });
  if (a.flags.includes('isolasi')) out.push({ label: 'Isolasi', tone: 'warning' });
  if (a.flags.includes('rencana-pulang')) out.push({ label: 'Rencana pulang hari ini', tone: 'info' });
  return out;
}
