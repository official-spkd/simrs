import { describe, expect, it } from 'vitest';
import {
  allowedRules,
  deidBlock,
  ethicsBlock,
  kAnonymity,
  privacyApproveBlock,
  quasiKey,
} from './dataset-riset';
import { cohort, DATASET_FIELDS } from './demo/fixtures/dataset-riset';
import { DEMO_TODAY } from './demo/fixtures/waktu';

const base = {
  name: 'hapus',
  rm: 'pseudonim',
  nik: 'hapus',
  phone: 'hapus',
  hba1c: 'pertahankan',
  episodes: 'pertahankan',
  insulin: 'pertahankan',
} as const;

describe('I11 · dataset riset', () => {
  it('pengenal langsung hanya boleh dihapus/disamarkan', () => {
    expect(allowedRules('pengenal')).toEqual(['hapus', 'pseudonim']);
    expect(
      deidBlock(
        DATASET_FIELDS,
        { ...base, name: 'pertahankan', age: 'generalisasi', sex: 'pertahankan', district: 'hapus' },
        9,
      ),
    ).toMatch(/Nama pasien/);
    expect(deidBlock(DATASET_FIELDS, { ...base }, 9)).toMatch(/3 kolom/);
  });

  it('k-anonimitas: umur persis atau kota masih gagal; kelompok umur tanpa wilayah lolos (k ≥ 5)', () => {
    const rows = cohort();
    const strict = kAnonymity(rows, { age: 'pertahankan', sex: 'pertahankan', district: 'pertahankan' });
    expect(strict).toBeLessThan(5);
    const general = kAnonymity(rows, { age: 'generalisasi', sex: 'pertahankan', district: 'generalisasi' });
    expect(general).toBeLessThan(5);
    const safe = kAnonymity(rows, { age: 'generalisasi', sex: 'pertahankan', district: 'hapus' });
    expect(safe).toBeGreaterThanOrEqual(5);
    expect(
      deidBlock(
        DATASET_FIELDS,
        { ...base, age: 'generalisasi', sex: 'pertahankan', district: 'hapus' },
        safe,
      ),
    ).toBeNull();
    expect(
      quasiKey(
        { age: 57, sex: 'P', district: 'X', city: 'Kota A' },
        { age: 'generalisasi', district: 'generalisasi' },
      ),
    ).toBe('50-an|P|Kota A');
  });

  it('etik berlaku dan penyetuju ≠ pemohon', () => {
    expect(ethicsBlock('KEPK/123/2026', '2027-09-30', DEMO_TODAY)).toBeNull();
    expect(ethicsBlock('KEPK 1', '2027-09-30', DEMO_TODAY)).toMatch(/nomor/);
    expect(ethicsBlock('KEPK/123/2026', '2026-10-01', DEMO_TODAY)).toMatch(/tidak berlaku/);
    expect(privacyApproveBlock('A', 'A')).toMatch(/berbeda/);
    expect(privacyApproveBlock('A', 'B')).toBeNull();
  });
});
