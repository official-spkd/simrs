import { hhCompliance } from './ppi';
import { type Grade, responseRate, satisfactionIndex, type SurveyResponse } from './pengalaman';

/**
 * B06 · Indikator mutu yang dihitung dari data transaksi (rencana fase 8 §8.4a, mesin indikator): pembilang dan
 * penyebut diambil dari catatan layanan (observasi PPI, pengaduan, survei, resume), bukan diketik. Nilainya harus
 * sama dengan indikator di layar Mutu dan Dasbor direksi (dijaga tes).
 */

export interface DischargeRecord {
  dischargedAt: string;
  /** Resume ditandatangani (TTE); null = belum. */
  resumeSignedAt: string | null;
}

export interface ComputedIndicator {
  id: string;
  label: string;
  numerator: number;
  denominator: number;
  value: number;
  unit: '%' | 'indeks';
  source: string;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

/** Resume final ≤ 1×24 jam pasca-pulang. */
export function resumeOnTime(records: readonly DischargeRecord[]): { within: number; total: number } {
  const within = records.filter(
    (r) => r.resumeSignedAt && Date.parse(r.resumeSignedAt) - Date.parse(r.dischargedAt) <= 24 * 3_600_000,
  ).length;
  return { within, total: records.length };
}

export function computeIndicators(input: {
  handHygiene: ReadonlyArray<{ action: 'handrub' | 'cuci' | 'tidak' }>;
  ppe: ReadonlyArray<{ compliant: boolean }>;
  complaints: ReadonlyArray<{ receivedAt: string; grade: Grade; answeredAt: string | null }>;
  survey: readonly SurveyResponse[];
  discharges: readonly DischargeRecord[];
  now: string;
}): ComputedIndicator[] {
  const hh = hhCompliance(input.handHygiene);
  const ppeDone = input.ppe.filter((p) => p.compliant).length;
  const rate = responseRate(input.complaints, input.now);
  const resume = resumeOnTime(input.discharges);
  return [
    {
      id: 'kebersihan-tangan',
      label: 'Kepatuhan kebersihan tangan',
      numerator: hh.done,
      denominator: hh.total,
      value: hh.pct ?? 0,
      unit: '%',
      source: 'Observasi 5 momen (PPI)',
    },
    {
      id: 'apd',
      label: 'Kepatuhan penggunaan APD',
      numerator: ppeDone,
      denominator: input.ppe.length,
      value: pct(ppeDone, input.ppe.length),
      unit: '%',
      source: 'Audit APD (PPI)',
    },
    {
      id: 'komplain',
      label: 'Kecepatan waktu tanggap komplain',
      numerator: rate.within,
      denominator: rate.total,
      value: rate.pct ?? 0,
      unit: '%',
      source: 'Pengaduan 30 hari (pengalaman pasien)',
    },
    {
      id: 'kepuasan',
      label: 'Kepuasan pasien',
      numerator: input.survey.length,
      denominator: input.survey.length,
      value: satisfactionIndex(input.survey) ?? 0,
      unit: 'indeks',
      source: 'Survei pasca-pulang',
    },
    {
      id: 'resume-24j',
      label: 'Resume medis final ≤ 1×24 jam pasca-pulang',
      numerator: resume.within,
      denominator: resume.total,
      value: pct(resume.within, resume.total),
      unit: '%',
      source: 'Kunjungan pulang + TTE resume (rekam medis)',
    },
  ];
}
