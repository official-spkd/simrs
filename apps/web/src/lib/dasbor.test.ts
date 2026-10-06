import { DASHBOARD_PERIODS, executiveDashboardSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  capacityRows,
  formatKpiDelta,
  formatKpiValue,
  kpiOnTrack,
  payerShares,
  revenueChart,
} from './dasbor';
import { demoExecutiveDashboard } from './demo/fixtures/dasbor';
import { CLAIM_KPIS } from './demo/fixtures/keuangan';
import { INVENTORY } from './demo/fixtures/manajemen';
import { daysOfCover } from './manajemen';

describe('data dummy Dasbor direksi', () => {
  it('setiap rentang lolos kontrak (skema ketat yang nanti dipenuhi API)', () => {
    for (const p of DASHBOARD_PERIODS)
      expect(() => executiveDashboardSchema.parse(demoExecutiveDashboard(p))).not.toThrow();
  });

  it('angka yang bisa dihitung konsisten: BOR hari ini = kapasitas rawat inap; judul ICU = kapasitas ICU', () => {
    const d = demoExecutiveDashboard('hari-ini');
    const bor = d.kpis.find((k) => k.id === 'bor');
    const ranap = capacityRows(d.capacity).find((c) => c.id === 'ranap-kelas');
    expect(bor?.value).toBe(ranap?.percent);
    const icu = capacityRows(d.capacity).find((c) => c.id === 'icu');
    expect(d.alerts[0]?.title).toContain(`ICU ${icu?.percent}%`);
    expect(icu?.high).toBe(true);
  });

  it('butir "Perlu keputusan direksi" sama dengan layar asalnya (Klaim, Logistik)', () => {
    const alerts = demoExecutiveDashboard('bulan').alerts;
    const pendingJuta = BigInt(CLAIM_KPIS.pending.value) / 1_000_000n;
    expect(alerts.find((a) => a.id === 'klaim')?.title).toBe(`Klaim pending Rp ${pendingJuta} jt > 30 hari`);
    const enox = INVENTORY.find((i) => i.id === 'enoksaparin-60');
    expect(enox).toBeDefined();
    expect(daysOfCover(enox?.stock ?? 0, enox?.avgDailyUse ?? 1)).toBeLessThan(7);
    expect(enox?.channel).toBe('po-darurat');
    expect(alerts.find((a) => a.id === 'stok')?.title).toBe('Stok enoksaparin < 7 hari');
  });

  it('pendapatan 30 hari berakhir kemarin; realisasi dihitung dari deret', () => {
    const r = revenueChart(demoExecutiveDashboard('bulan').revenue);
    expect(r.actual).toHaveLength(30);
    expect(r.rows.at(-1)?.date).toBe('4 Okt');
    expect(r.xLabels.map((x) => x.label)).toEqual(['5 Sep', '19 Sep', '4 Okt']);
    // Σ realisasi 6.478 juta / Σ anggaran 6.210 juta (seperti mockup: 104%).
    expect(r.realizationPercent).toBe(104);
  });

  it('bauran penjamin dijumlah 100% dengan margin bertanda', () => {
    const s = payerShares(demoExecutiveDashboard('bulan').payerMix);
    expect(s.map((x) => x.share)).toEqual([71, 14, 11, 4]);
    expect(s[0]).toMatchObject({ margin: '−3,8%', marginNegative: true });
    expect(s[1]?.margin).toBe('+22%');
  });
});

describe('format KPI', () => {
  it('nilai, perubahan, dan sasaran', () => {
    expect(formatKpiValue({ value: 4.8, unit: 'hari' })).toBe('4,8 hari');
    expect(formatKpiValue({ value: 1148, unit: 'pasien' })).toBe('1.148');
    expect(formatKpiValue({ value: 93.8, unit: 'persen' })).toBe('93,8%');
    expect(formatKpiDelta({ delta: -5, deltaUnit: 'menit', comparedTo: 'vs kemarin' })).toBe(
      '▼ 5 mnt vs kemarin',
    );
    expect(formatKpiDelta({ delta: 0.5, deltaUnit: 'hari', comparedTo: 'vs Sep' })).toBe('▲ 0,5 hari vs Sep');
    expect(formatKpiDelta({ delta: 0, deltaUnit: 'poin', comparedTo: 'vs Sep' })).toBe('tetap vs Sep');
    expect(kpiOnTrack({ value: 82, target: { min: 60, max: 85, label: '' } })).toBe(true);
    expect(kpiOnTrack({ value: 4.8, target: { max: 4.3, label: '' } })).toBe(false);
    expect(kpiOnTrack({ value: 93.8, target: { min: 96, label: '' } })).toBe(false);
  });
});
