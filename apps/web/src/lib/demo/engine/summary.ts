import { sumRupiah } from '@simrs/shared';
import { type LogKind, logKind } from './format';
import type { ExtraStat, RunResult } from './types';

/** Baris "Rekam medis terbentuk" (hanya yang sudah terisi). */
export function recordRows(R: RunResult): Array<{ label: string; value: string }> {
  const r = R.rec;
  const rows: Array<[string, string]> = [
    ['Penjamin', r.penjamin],
    ['No. SEP', r.sep],
    ['Antrean', r.antrean],
    ['Tanda vital', r.ttv],
    ['Triase', r.triase],
    ['Diagnosis', r.dx.join('\n')],
    ['Order', r.order.join('\n')],
    ['Hasil', r.hasil.join('\n')],
    ['Obat', r.obat.join('\n')],
    ['Tindakan', r.tindakan.join('\n')],
    ['Pembayaran', r.bayar.join('\n')],
    ['Pembiayaan BTN', r.biaya.join('\n')],
    ['Kontrol', r.kontrol],
    ['Klaim', r.klaim],
  ];
  return rows.filter(([, v]) => v).map(([label, value]) => ({ label, value }));
}

export type IntegrationCounts = Record<Exclude<LogKind, 'internal'>, number>;

export function integrationCounts(R: RunResult): IntegrationCounts {
  const n: IntegrationCounts = { bpjs: 0, satusehat: 0, keselamatan: 0, pembayaran: 0 };
  for (const l of R.logs) {
    const k = logKind(l.sys);
    if (k !== 'internal') n[k] += 1;
  }
  return n;
}

/** Task ID antrean BPJS 1–7 (rawat jalan) dan menit pertama kali terkirim. */
export const BPJS_QUEUE_TASKS = [
  'Mulai tunggu admisi',
  'Mulai layan admisi',
  'Mulai tunggu poli',
  'Mulai layan poli',
  'Mulai tunggu farmasi',
  'Mulai layan farmasi',
  'Obat selesai',
] as const;

export function bpjsQueueTasks(R: RunResult): Array<{ n: number; name: string; at: number | null }> {
  return BPJS_QUEUE_TASKS.map((name, i) => ({
    n: i + 1,
    name,
    at: R.logs.find((l) => l.sys === `BPJS Antrean · task ${i + 1}`)?.t ?? null,
  }));
}

export interface BillSummary {
  total: bigint;
  /** null = belum difinalkan. */
  covered: bigint | null;
  patient: bigint | null;
}

export function billSummary(R: RunResult): BillSummary {
  const total = sumRupiah(R.charges.map((c) => c.amount));
  const patient = R.rec.bayarPasien;
  return { total, covered: patient === null ? null : total - patient, patient };
}

export interface ScenarioSummary {
  /** Menit dari kedatangan sampai pulang (atau sampai jam terakhir bila belum pulang). */
  lengthOfStay: number;
  waitMinutes: number;
  serviceMinutes: number;
  /** Persentase menunggu, dibulatkan. */
  waitPercent: number;
  bill: BillSummary;
  chargeLines: number;
  counts: IntegrationCounts;
  auditEvents: number;
  bars: Array<{ stage: string; wait: number; service: number }>;
  extra: ExtraStat[];
}

export function scenarioSummary(R: RunResult): ScenarioSummary {
  const waitMinutes = R.per.reduce((a, p) => a + p.wait, 0);
  const serviceMinutes = R.per.reduce((a, p) => a + p.svc, 0);
  const end = R.rec.pulangAt ?? R.clock;
  return {
    lengthOfStay: end - R.def.startMin,
    waitMinutes,
    serviceMinutes,
    waitPercent: Math.round((waitMinutes / Math.max(waitMinutes + serviceMinutes, 1)) * 100),
    bill: billSummary(R),
    chargeLines: R.charges.length,
    counts: integrationCounts(R),
    auditEvents: R.logs.length,
    bars: R.def.steps.map((s, i) => ({
      stage: s.stage,
      wait: R.per[i]?.wait ?? 0,
      service: R.per[i]?.svc ?? 0,
    })),
    extra: R.def.extra?.(R.rec) ?? [],
  };
}
