import { describe, expect, it } from 'vitest';
import { attributeList, comparisonBanner, defaultPicks, type RowLike, takenFromB } from './mpi';

const rows: RowLike[] = [
  { attribute: 'name', label: 'Nama', a: 'Siti Rahmawati', b: 'Siti Rachmawati', match: 'mirip' },
  { attribute: 'nik', label: 'NIK', a: '9999••••••••4521', b: null, match: 'kosong' },
  { attribute: 'birthDate', label: 'Tanggal lahir', a: '14 Mar 1972', b: '14 Mar 1972', match: 'sama' },
  { attribute: 'motherName', label: 'Nama ibu kandung', a: 'Aminah', b: 'Aminah', match: 'sama' },
  { attribute: 'bpjs', label: 'No. peserta BPJS', a: null, b: '0000012•••678', match: 'kosong' },
  { attribute: 'address', label: 'Alamat', a: 'Jl. Kenanga 12', b: 'Kenanga No.12', match: 'sama' },
];

describe('layar MPI', () => {
  it('sumber bawaan: A, kecuali A kosong dan B berisi', () => {
    expect(defaultPicks(rows)).toEqual({
      name: 'a',
      nik: 'a',
      birthDate: 'a',
      motherName: 'a',
      bpjs: 'b',
      address: 'a',
    });
  });

  it('atribut yang diambil dari B: dipilih B, berisi, dan memang berbeda', () => {
    const picks = { ...defaultPicks(rows), name: 'b' as const, birthDate: 'b' as const, nik: 'b' as const };
    expect(takenFromB(rows, picks)).toEqual(['name', 'bpjs']);
    expect(attributeList(['name', 'bpjs'])).toBe('Nama, No. peserta BPJS');
  });

  it('kalimat penjelasan dari hasil banding; singkatan tetap kapital', () => {
    expect(comparisonBanner(rows)).toBe(
      'Tanggal lahir, nama ibu kandung, dan alamat sama. Nama mirip. NIK kosong di rekam medis B; verifikasi KTP sebelum digabung.',
    );
    expect(
      comparisonBanner([
        { attribute: 'nik', label: 'NIK', a: 'x', b: 'y', match: 'beda' },
        { attribute: 'birthDate', label: 'Tanggal lahir', a: 'x', b: 'x', match: 'sama' },
      ]),
    ).toBe('Tanggal lahir sama. NIK berbeda: pastikan bukan dua orang berbeda.');
  });
});
