import { describe, expect, it } from 'vitest';
import {
  diffAnswers,
  type FormSchema,
  formReadyProblems,
  formSchemaSchema,
  MORSE_FALL_SCALE,
  scoreForm,
  validateAnswers,
} from './forms';

const morse = formSchemaSchema.parse(MORSE_FALL_SCALE.schema);

describe('form engine (P07)', () => {
  it('Morse dari mockup: skor otomatis dan kategori 0–24 / 25–44 / ≥ 45', () => {
    expect(scoreForm(morse, {})).toMatchObject({ total: 0, answered: 0, scored: 6, band: null });
    const sedang = scoreForm(morse, { q_riwayat_jatuh: 'ya' });
    expect(sedang).toMatchObject({
      total: 25,
      answered: 1,
      band: { label: 'Risiko sedang', tone: 'warning' },
    });
    const tinggi = scoreForm(morse, {
      q_riwayat_jatuh: 'ya',
      q_diag_sekunder: 'ya',
      q_alat_bantu: 'furnitur',
      q_infus: 'tidak',
      q_gaya_jalan: 'normal',
      q_mental: 'sadar',
    });
    expect(tinggi).toMatchObject({
      total: 70,
      answered: 6,
      band: { label: 'Risiko tinggi', tone: 'danger' },
    });
  });

  it('validasi isian: wajib, opsi sah, field tak dikenal, skor tidak diisi manual', () => {
    expect(validateAnswers(morse, { q_riwayat_jatuh: 'ya' })).toMatchObject({
      q_diag_sekunder: 'Diagnosis sekunder (lebih dari satu) wajib diisi',
    });
    const errors = validateAnswers(morse, { q_riwayat_jatuh: 'mungkin', q_lain: 'x', skor_total: 99 });
    expect(errors).toMatchObject({
      q_riwayat_jatuh: 'Pilihan tidak dikenal',
      q_lain: 'Field tidak ada di versi formulir ini',
      skor_total: 'Skor dihitung otomatis, tidak diisi manual',
    });
  });

  it('logika tampil, angka, ICD-10; diff memakai label opsi', () => {
    const schema: FormSchema = formSchemaSchema.parse({
      sections: [
        {
          title: 'Uji',
          fields: [
            {
              key: 'nyeri',
              type: 'single',
              label: 'Ada nyeri?',
              required: true,
              options: [
                { value: 'ya', label: 'Ya' },
                { value: 'tidak', label: 'Tidak' },
              ],
            },
            {
              key: 'skala',
              type: 'number',
              label: 'Skala nyeri',
              required: true,
              min: 0,
              max: 10,
              showWhen: { field: 'nyeri', equals: 'ya' },
            },
            { key: 'dx', type: 'icd10', label: 'Diagnosis' },
          ],
        },
      ],
    });
    expect(validateAnswers(schema, { nyeri: 'tidak' })).toEqual({});
    expect(validateAnswers(schema, { nyeri: 'tidak', skala: 3 })).toMatchObject({
      skala: 'Field ini tidak tampil untuk jawaban yang dipilih',
    });
    expect(validateAnswers(schema, { nyeri: 'ya' })).toMatchObject({ skala: 'Skala nyeri wajib diisi' });
    expect(validateAnswers(schema, { nyeri: 'ya', skala: 11, dx: 'J18,9' })).toMatchObject({
      skala: 'Di luar rentang 0–10',
      dx: 'Kode ICD-10 tidak valid',
    });
    expect(diffAnswers(schema, { nyeri: 'ya', skala: 7 }, { nyeri: 'ya', skala: 5 })).toEqual([
      { key: 'skala', label: 'Skala nyeri', before: '7', after: '5' },
    ]);
    expect(diffAnswers(morse, { q_riwayat_jatuh: 'tidak' }, { q_riwayat_jatuh: 'ya' })[0]).toMatchObject({
      before: 'Tidak',
      after: 'Ya',
    });
  });

  it('definisi tidak sah ditolak; draf berlabel kosong belum bisa diajukan', () => {
    const dup = formSchemaSchema.safeParse({
      sections: [
        {
          title: 'A',
          fields: [
            { key: 'a1', type: 'text', label: 'A' },
            { key: 'a1', type: 'text', label: 'B' },
          ],
        },
      ],
    });
    expect(dup.success).toBe(false);
    const oneOption = formSchemaSchema.safeParse({
      sections: [
        {
          title: 'A',
          fields: [{ key: 'p', type: 'single', label: 'P', options: [{ value: 'x', label: 'X' }] }],
        },
      ],
    });
    expect(oneOption.success).toBe(false);
    const draft = formSchemaSchema.parse({
      sections: [{ title: 'A', fields: [{ key: 'b1', type: 'text', label: '' }] }],
    });
    expect(formReadyProblems(draft)).toEqual(['1 field belum berlabel']);
    expect(formReadyProblems(morse)).toEqual([]);
    // Draf setengah jadi tetap sah disimpan; kelengkapannya baru ditagih saat diajukan.
    const rough = formSchemaSchema.parse({
      sections: [
        {
          title: '',
          fields: [
            {
              key: 'pilih',
              type: 'single',
              label: 'P',
              options: [
                { value: 'a', label: '' },
                { value: 'b', label: 'B' },
              ],
            },
          ],
        },
      ],
      scoring: {
        bands: [
          { min: 0, label: '', tone: 'success' },
          { min: 0, label: 'Tinggi', tone: 'danger' },
        ],
      },
    });
    expect(formReadyProblems(rough)).toEqual([
      '1 bagian belum berjudul',
      '1 opsi belum berlabel',
      '1 kategori skor belum berlabel',
      'batas kategori skor ganda',
    ]);
    expect(formReadyProblems(formSchemaSchema.parse({ sections: [{ title: 'A', fields: [] }] }))).toEqual([
      'formulir belum punya field isian',
    ]);
  });
});
