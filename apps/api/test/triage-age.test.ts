/**
 * K03 · Umur untuk saran triase dihitung pada tanggal WIB, bukan UTC: pukul 00.00–06.59 WIB tanggal UTC masih hari
 * sebelumnya, jadi pasien yang berulang tahun ke-16 hari itu sempat dinilai dengan ambang anak (`TRIAGE_ADULT_AGE`).
 */
import { TRIAGE_ADULT_AGE } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { triageAgeYears } from '../src/modules/triage/triage.service';

describe('umur saran triase (WIB)', () => {
  const birth = new Date('2010-10-07T00:00:00Z');

  it('ulang tahun ke-16 pukul 01.00 WIB (masih 6 Okt UTC): sudah 16 tahun, ambang dewasa', () => {
    const at = new Date('2026-10-06T18:00:00Z'); // Rab, 7 Okt 2026 · 01.00 WIB
    expect(triageAgeYears(birth, at)).toBe(16);
    expect(triageAgeYears(birth, at)).toBeGreaterThanOrEqual(TRIAGE_ADULT_AGE);
  });

  it('sehari sebelum ulang tahun pukul 23.00 WIB: masih 15 tahun', () => {
    expect(triageAgeYears(birth, new Date('2026-10-06T16:00:00Z'))).toBe(15);
  });

  it('tanggal lahir tidak diketahui: null', () => {
    expect(triageAgeYears(null, new Date())).toBeNull();
  });
});
