import { describe, expect, it } from 'vitest';
import { ENCOUNTER_ID } from './demo/fixtures/ids';
import { EXTRA_RESULTS } from './demo/fixtures/rme-ringkasan';
import { rmeChartByEncounter } from './demo/fixtures/rme-pasien';
import { lastVitals, latestResults, riskFlags } from './rme-ringkasan';

describe('ringkasan pasien (K14)', () => {
  it('hasil terbaru: nilai kritis di atas, satu baris per pemeriksaan (nilai terakhir)', () => {
    const d = rmeChartByEncounter(ENCOUNTER_ID.yusuf)?.inpatient;
    if (!d) throw new Error('yusuf');
    const res = latestResults([...d.results, ...(EXTRA_RESULTS[ENCOUNTER_ID.yusuf] ?? [])]);
    expect(res[0]).toMatchObject({ name: 'Kalium', value: '6,4 mmol/L', flag: 'kritis' });
    expect(res.filter((r) => r.name === 'Kalium')).toHaveLength(1);
  });

  it('GDS Ny. Endang: nilai terbaru 236 menggantikan 188 dan 254', () => {
    const d = rmeChartByEncounter(ENCOUNTER_ID.endang)?.inpatient;
    if (!d) throw new Error('endang');
    const gds = latestResults(d.results).filter((r) => r.name === 'Gula darah sewaktu');
    expect(gds.map((r) => r.value)).toEqual(['236 mg/dL']);
    expect(lastVitals(d.observations)).toMatchObject({ spo2: 96, level: 'rendah' });
    expect(lastVitals([])).toBeNull();
  });

  it('flag risiko bertulisan: alergi, nilai kritis, EWS, risiko, rencana pulang', () => {
    const flags = riskFlags({
      allergies: ['Amoksisilin'],
      results: [{ at: '2026-10-05T10:39:00+07:00', name: 'Kalium', value: '6,4 mmol/L', flag: 'kritis' }],
      ewsLevel: 'sedang',
      risk: 'Risiko jatuh sedang · Morse 35',
      flags: ['rencana-pulang'],
    });
    expect(flags.map((f) => f.label)).toEqual([
      'Alergi Amoksisilin',
      'Nilai kritis: Kalium 6,4 mmol/L',
      'EWS sedang',
      'Risiko jatuh sedang · Morse 35',
      'Rencana pulang hari ini',
    ]);
    expect(riskFlags({ allergies: [], results: [], ewsLevel: 'rendah', risk: null, flags: [] })).toEqual([]);
  });
});
