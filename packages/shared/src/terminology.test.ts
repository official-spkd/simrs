import { describe, expect, it } from 'vitest';
import { isValidRefCode, loincCheckDigitValid, regionInfo } from './terminology';

describe('kode rujukan (P06)', () => {
  it('format per sistem', () => {
    expect(isValidRefCode('icd10', 'J18.9')).toBe(true);
    expect(isValidRefCode('icd10', 'I10')).toBe(true);
    expect(isValidRefCode('icd10', 'J18,9')).toBe(false);
    expect(isValidRefCode('icd9cm', '51.23')).toBe(true);
    expect(isValidRefCode('icd9cm', '74.1')).toBe(true);
    expect(isValidRefCode('icd9cm', '5123')).toBe(false);
    expect(isValidRefCode('kfa', '93000387')).toBe(true);
    expect(isValidRefCode('kfa', '9300038')).toBe(false);
  });

  it('check digit LOINC menangkap salah ketik', () => {
    for (const code of ['718-7', '2160-0', '13457-7', '10839-9', '2345-7']) {
      expect(loincCheckDigitValid(code)).toBe(true);
    }
    expect(loincCheckDigitValid('718-8')).toBe(false);
    expect(loincCheckDigitValid('2106-0')).toBe(false);
    expect(isValidRefCode('loinc', '718-8')).toBe(false);
  });

  it('tingkat dan induk kode wilayah', () => {
    expect(regionInfo('31')).toEqual({ level: 'provinsi', parent: null });
    expect(regionInfo('31.75')).toEqual({ level: 'kabupaten', parent: '31' });
    expect(regionInfo('31.75.01')).toEqual({ level: 'kecamatan', parent: '31.75' });
    expect(regionInfo('31.75.01.1001')).toEqual({ level: 'desa', parent: '31.75.01' });
    expect(regionInfo('31.7')).toBeNull();
    expect(regionInfo('3175')).toBeNull();
  });
});
