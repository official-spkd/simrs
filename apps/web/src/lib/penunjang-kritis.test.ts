import { SEED_REF_SAMPLES } from '@simrs/db';
import { describe, expect, it } from 'vitest';
import { LAB_SAMPLE_ID } from './demo/fixtures/ids';
import { demoLabSamples } from './demo/fixtures/penunjang';
import { CRITICAL_HISTORY_7D, criticalFromLab, demoOtherCriticals } from './demo/fixtures/penunjang-kritis';
import { DEMO_NOW } from './demo/fixtures/waktu';
import {
  applyReports,
  complianceMetrics,
  type CriticalItem,
  criticalState,
  durationMetrics,
  elapsedSecondsAt,
  escalationLevel,
  formatPercentId,
  median,
  percentile,
  reportGate,
  reportMinutes,
  sortCritical,
} from './penunjang-kritis';

const items = (): CriticalItem[] => [
  ...demoLabSamples().flatMap((s) => {
    const c = criticalFromLab(s);
    return c ? [c] : [];
  }),
  ...demoOtherCriticals(),
];
const yusuf = () => {
  const s = demoLabSamples().find((x) => x.id === LAB_SAMPLE_ID.yusuf);
  const c = s && criticalFromLab(s);
  if (!c) throw new Error('kalium kritis Tn. Yusuf');
  return c;
};
const ok = {
  recipient: 'dr. Sinta Maharani, Sp.PD-KGH',
  recipientRole: 'DPJP',
  channel: 'telepon',
  readBack: true,
} as const;

describe('data hasil kritis', () => {
  it('nilai kritis lab diturunkan dari worklist Lab yang sama (kalium 6,4 Tn. Yusuf terbuka)', () => {
    const y = yusuf();
    expect(y).toMatchObject({ valueText: '6,4 mmol/L', report: null, scenario: false, limitMinutes: 30 });
    expect(y.test).toContain('LOINC 2823-3');
  });

  it('kode LOINC yang disebut hanya dari contoh seed; id unik tanpa nama pasien', () => {
    const loinc = new Set(SEED_REF_SAMPLES.loinc.map((c) => c.code));
    const list = items();
    for (const i of list)
      for (const m of i.test.matchAll(/LOINC (\S+)/g)) expect(loinc.has(m[1] ?? '')).toBe(true);
    expect(new Set(list.map((i) => i.id)).size).toBe(list.length);
    for (const i of list) expect(i.id).toMatch(/^kr-[a-z0-9-]+$/i);
  });
});

describe('timer, status, dan eskalasi', () => {
  it('timer dari waktu terbit; lewat batas → status lewat batas; laporan menghentikan timer', () => {
    const y = yusuf();
    expect(elapsedSecondsAt(y, DEMO_NOW)).toBe(6 * 60);
    expect(criticalState(y, 6 * 60)).toBe('terbuka');
    expect(criticalState(y, 30 * 60)).toBe('lewat-batas');
    const reported = applyReports([y], {
      [y.id]: { ...ok, reportedBy: 'x', reportedAt: '2026-10-05T10:51:00+07:00', readBackConfirmed: true },
    })[0];
    expect(reported && criticalState(reported, 99 * 60)).toBe('dilaporkan');
    expect(reported && reportMinutes(reported)).toBe(12);
  });

  it('eskalasi 1 tepat di batas, eskalasi 2 di batas + 30 menit', () => {
    expect(escalationLevel(29 * 60 + 59, 30)).toBe(0);
    expect(escalationLevel(30 * 60, 30)).toBe(1);
    expect(escalationLevel(60 * 60, 30)).toBe(2);
  });
});

describe('gerbang pelaporan (penerima + read-back wajib)', () => {
  it('tanpa penerima, peran, saluran, atau read-back → ditolak per isian', () => {
    const errs = reportGate(yusuf(), { recipient: 'dr', recipientRole: '', channel: '', readBack: false });
    expect(errs.map((e) => e.field)).toEqual(['recipient', 'recipientRole', 'channel', 'readBack']);
  });

  it('read-back tetap wajib walau penerima lengkap', () => {
    expect(reportGate(yusuf(), { ...ok, readBack: false }).map((e) => e.field)).toEqual(['readBack']);
    expect(reportGate(yusuf(), ok)).toEqual([]);
  });

  it('hasil yang sudah dilaporkan atau tidak dikenal tidak bisa dilaporkan ulang', () => {
    const done = demoOtherCriticals()[0];
    expect(reportGate(done, ok)[0]?.field).toBe('item');
    expect(reportGate(undefined, ok)[0]?.field).toBe('item');
  });
});

describe('metrik kepatuhan', () => {
  it('median dan persentil nearest-rank', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([7], 90)).toBe(7);
  });

  it('hari ini: terbuka, lewat batas, persen ≤ 30 menit dari yang sudah dilaporkan', () => {
    const list = items();
    const elapsed = Object.fromEntries(list.map((i) => [i.id, elapsedSecondsAt(i, DEMO_NOW)]));
    const m = complianceMetrics(list, elapsed);
    expect(m).toMatchObject({ open: 1, overdue: 0, reported: 2, withinLimit: 2, percent: 100 });
    const late = Object.fromEntries(list.map((i) => [i.id, 45 * 60]));
    expect(complianceMetrics(list, late).overdue).toBe(1);
  });

  it('7 hari: dua laporan melewati batas → di bawah sasaran 95%', () => {
    const w = durationMetrics(CRITICAL_HISTORY_7D, 30);
    expect(w.total).toBe(30);
    expect(w.withinLimit).toBe(28);
    expect(formatPercentId(w.percent)).toBe('93,3%');
    expect(formatPercentId(100)).toBe('100%');
  });

  it('urutan: belum dilaporkan dulu (paling lama menunggu di atas)', () => {
    expect(sortCritical(items())[0]?.report).toBeNull();
  });
});
