import { describe, expect, it } from 'vitest';
import { ENCOUNTER_ID } from './demo/fixtures/ids';
import {
  chartPatient,
  DEFAULT_RME_ENCOUNTER,
  demoRmeCharts,
  rmeChartByEncounter,
} from './demo/fixtures/rme-pasien';
import { encounterIdOf, patientById } from './demo/fixtures/pasien';
import { chartHref, chartLinks, hasReason, openRoute, reasonShortBy } from './rme';

describe('bagan RME per pasien', () => {
  it('kunjungan unik, cocok dengan fixture pasien; pasien skenario Simulasi tidak masuk', () => {
    const charts = demoRmeCharts();
    expect(new Set(charts.map((c) => c.encounterId)).size).toBe(charts.length);
    for (const c of charts) {
      expect(encounterIdOf(c.patientId)).toBe(c.encounterId);
      expect(patientById(c.patientId)?.scenario).toBeUndefined();
      expect(chartPatient(c).rm).toMatch(/^\d{2}-\d{2}-\d{2}-\d{2}$/);
    }
    expect(rmeChartByEncounter(DEFAULT_RME_ENCOUNTER)?.inpatient?.summary.bed).toBe('M-203');
    expect(rmeChartByEncounter(ENCOUNTER_ID.suryo)).toBeUndefined();
  });

  it('tautan bagan hanya untuk layar yang terbuka bagi posisi', () => {
    expect(chartHref('/klinis/cppt', 'e 1')).toBe('/klinis/cppt?pasien=e%201');
    const links = chartLinks('dokter', 'e1', 'worklist');
    for (const l of links) expect(l.href).toMatch(/\?pasien=e1$/);
    expect(chartLinks('kasir', 'e1', 'x')).toEqual([]);
    expect(openRoute('worklist', 'perawat')).toBe('/klinis/worklist');
    expect(openRoute('worklist', 'kasir')).toBeNull();
  });

  it('alasan minimal 10 karakter (tanpa spasi tepi)', () => {
    expect(hasReason('  pendek  ')).toBe(false);
    expect(hasReason('Salah ketik nilai SpO2')).toBe(true);
    expect(reasonShortBy('abc')).toBe(7);
  });
});
