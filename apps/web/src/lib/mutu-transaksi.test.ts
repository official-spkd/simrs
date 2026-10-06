import { describe, expect, it } from 'vitest';
import { demoQualityOverview } from './demo/fixtures/manajemen';
import { dischargeRecords } from './demo/fixtures/mutu-transaksi';
import { recentComplaints, surveyResponses } from './demo/fixtures/pengalaman';
import { handHygieneObservations, ppeAudits } from './demo/fixtures/ppi';
import { DEMO_NOW } from './demo/fixtures/waktu';
import { computeIndicators, resumeOnTime } from './mutu-transaksi';

describe('B06 · indikator dari data transaksi', () => {
  const computed = computeIndicators({
    handHygiene: handHygieneObservations(),
    ppe: ppeAudits(),
    complaints: recentComplaints(),
    survey: surveyResponses(),
    discharges: dischargeRecords(),
    now: DEMO_NOW,
  });

  it('lima indikator dihitung dari pembilang/penyebut transaksi', () => {
    expect(computed).toHaveLength(5);
    for (const c of computed) expect(c.denominator, c.id).toBeGreaterThan(0);
    expect(resumeOnTime(dischargeRecords())).toEqual({ within: 44, total: 50 });
  });

  it('nilai sama dengan indikator di layar Mutu (dan Dasbor direksi)', () => {
    const shown = new Map(demoQualityOverview().indicators.map((q) => [q.id, q.value]));
    for (const c of computed) expect(c.value, c.id).toBe(shown.get(c.id));
  });

  it('semua catatan pulang dan TTE resume sebelum jam demo', () => {
    for (const r of dischargeRecords()) {
      expect(Date.parse(r.dischargedAt)).toBeLessThan(Date.parse(DEMO_NOW));
      if (r.resumeSignedAt) expect(Date.parse(r.resumeSignedAt)).toBeLessThan(Date.parse(DEMO_NOW));
    }
  });
});
