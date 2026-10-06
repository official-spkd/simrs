import { describe, expect, it } from 'vitest';
import {
  ewsRepeatLabel,
  formatTglSingkat,
  gdsTrend,
  nextObservationText,
  nursingShift,
  TRIAGE_META,
  TRIAGE_SAVE_DISABLED,
} from './rawat-inap';

describe('tampilan rawat inap (mockup Ranap)', () => {
  it('observasi berikutnya mengikuti interval EWS; tinggi = pantau kontinu', () => {
    expect(nextObservationText('2026-10-05T11:00:00+07:00', 'rendah')).toBe('Observasi berikutnya 15.00.');
    expect(nextObservationText('2026-10-05T11:00:00+07:00', 'sedang')).toBe('Observasi berikutnya 12.00.');
    expect(nextObservationText('2026-10-05T11:00:00+07:00', 'tinggi')).toMatch(/pantau kontinu/);
    expect(ewsRepeatLabel('rendah')).toBe('ulang tiap 4 jam');
    expect(ewsRepeatLabel('tinggi')).toBe('pantau kontinu');
  });

  it('GDS terakhir + tren dari hasil penunjang, tanpa mengarang bila tidak ada', () => {
    const t = gdsTrend([
      { at: '2026-10-05T06:00:00+07:00', name: 'Gula darah sewaktu', value: '188 mg/dL', flag: 'tinggi' },
      { at: '2026-10-05T10:30:00+07:00', name: 'Gula darah sewaktu', value: '236 mg/dL', flag: 'tinggi' },
      { at: '2026-10-04T06:00:00+07:00', name: 'Gula darah sewaktu', value: '254 mg/dL', flag: 'tinggi' },
      { at: '2026-10-05T07:00:00+07:00', name: 'Hemoglobin', value: '12 g/dL', flag: 'normal' },
    ]);
    expect(t).toMatchObject({ value: '236 mg/dL', flag: 'tinggi', history: '06.00: 188 · kemarin: 254' });
    expect(
      gdsTrend([{ at: '2026-10-05T07:00:00+07:00', name: 'Hemoglobin', value: '12', flag: 'normal' }]),
    ).toBeNull();
  });

  it('shift keperawatan dan tanggal singkat', () => {
    expect(nursingShift('12.00')).toBe('pagi');
    expect(nursingShift('15.30')).toBe('sore');
    expect(nursingShift('22.00')).toBe('malam');
    expect(formatTglSingkat('2026-10-05T11:00:00+07:00')).toBe('5 Okt');
  });

  it('IGD: saran sistem dan tombol simpan berwarna per level, abu bila nonaktif', () => {
    expect(TRIAGE_META[1].advice.box).toContain('var(--color-koral-50)');
    expect(TRIAGE_META[3].advice.box).toContain('var(--color-kunyit-50)');
    expect(TRIAGE_META[4].advice.box).toContain('var(--color-zamrud-50)');
    expect(TRIAGE_META[5].advice.box).toContain('var(--color-samudra-50)');
    expect(TRIAGE_META[2].save).toContain('#C4320A');
    expect(TRIAGE_SAVE_DISABLED).toContain('bg-batu-100');
  });
});
