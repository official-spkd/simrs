import { type FormSchema, formSchemaSchema, MORSE_FALL_SCALE, validateAnswers } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  fromWibInput,
  parseNumberInput,
  pruneAnswers,
  setAnswer,
  toggleOption,
  wibInputValue,
} from './form-renderer';

/** Formulir uji: logika tampil berantai (nyeri → skala → lokasi), angka bersatuan, pilihan ganda, tanggal/jam. */
const SCHEMA: FormSchema = formSchemaSchema.parse({
  sections: [
    {
      title: 'Asesmen nyeri',
      fields: [
        {
          key: 'nyeri',
          type: 'single',
          label: 'Ada nyeri?',
          required: true,
          options: [
            { value: 'tidak', label: 'Tidak' },
            { value: 'ya', label: 'Ya' },
          ],
        },
        {
          key: 'skala',
          type: 'single',
          label: 'Skala nyeri',
          required: true,
          showWhen: { field: 'nyeri', equals: 'ya' },
          options: [
            { value: 'ringan', label: 'Ringan' },
            { value: 'berat', label: 'Berat' },
          ],
        },
        {
          key: 'lokasi',
          type: 'text',
          label: 'Lokasi nyeri berat',
          required: true,
          showWhen: { field: 'skala', equals: 'berat' },
        },
        { key: 'suhu', type: 'number', label: 'Suhu', unit: '°C', min: 30, max: 45 },
        {
          key: 'keluhan',
          type: 'multi',
          label: 'Keluhan penyerta',
          options: [
            { value: 'mual', label: 'Mual' },
            { value: 'pusing', label: 'Pusing' },
            { value: 'sesak', label: 'Sesak' },
          ],
        },
        { key: 'waktu', type: 'datetime', label: 'Waktu asesmen', required: true },
      ],
    },
  ],
});

describe('penyaji formulir P07 · perubahan jawaban', () => {
  it('jawaban kosong dihapus, bukan disimpan sebagai string kosong', () => {
    const a = setAnswer(SCHEMA, { nyeri: 'tidak' }, 'nyeri', '');
    expect(a).toEqual({});
    expect(setAnswer(SCHEMA, { keluhan: ['mual'] }, 'keluhan', [])).toEqual({});
    expect(setAnswer(SCHEMA, {}, 'suhu', undefined)).toEqual({});
  });

  it('logika tampil berantai: menyembunyikan induk membuang jawaban turunan', () => {
    let a = setAnswer(SCHEMA, {}, 'nyeri', 'ya');
    a = setAnswer(SCHEMA, a, 'skala', 'berat');
    a = setAnswer(SCHEMA, a, 'lokasi', 'Perut kanan bawah');
    expect(a).toEqual({ nyeri: 'ya', skala: 'berat', lokasi: 'Perut kanan bawah' });
    // "Tidak nyeri": skala tersembunyi, lalu lokasi (bergantung pada skala) ikut tersembunyi.
    expect(setAnswer(SCHEMA, a, 'nyeri', 'tidak')).toEqual({ nyeri: 'tidak' });
  });

  it('isian hasil penyaji lolos aturan bentuk validateAnswers (tanpa field tersembunyi atau tak dikenal)', () => {
    const dirty = { nyeri: 'tidak', skala: 'berat', lokasi: 'x', tidak_ada: 'y', suhu: 37.5 };
    const clean = pruneAnswers(SCHEMA, dirty);
    expect(clean).toEqual({ nyeri: 'tidak', suhu: 37.5 });
    const errors = validateAnswers(SCHEMA, { ...clean, waktu: fromWibInput('2026-10-05T10:45') ?? '' });
    expect(errors).toEqual({});
  });

  it('pilihan ganda: centang/lepas, urut sesuai definisi, tanpa duplikat', () => {
    const field = SCHEMA.sections[0]?.fields.find((f) => f.key === 'keluhan');
    if (!field) throw new Error('field keluhan tidak ada');
    expect(toggleOption(field, undefined, 'sesak')).toEqual(['sesak']);
    expect(toggleOption(field, ['sesak'], 'mual')).toEqual(['mual', 'sesak']);
    expect(toggleOption(field, ['mual', 'sesak'], 'mual')).toEqual(['sesak']);
  });

  it('skor Morse terhitung dari jawaban penyaji', () => {
    let a = setAnswer(MORSE_FALL_SCALE.schema, {}, 'q_riwayat_jatuh', 'ya');
    a = setAnswer(MORSE_FALL_SCALE.schema, a, 'q_infus', 'ya');
    expect(validateAnswers(MORSE_FALL_SCALE.schema, a)).toMatchObject({
      q_diag_sekunder: expect.stringContaining('wajib'),
    });
    expect(a).toEqual({ q_riwayat_jatuh: 'ya', q_infus: 'ya' });
  });
});

describe('penyaji formulir P07 · angka dan tanggal', () => {
  it('angka: koma desimal diterima; kosong atau bukan angka → hapus jawaban', () => {
    expect(parseNumberInput('37,5')).toBe(37.5);
    expect(parseNumberInput(' 120 ')).toBe(120);
    expect(parseNumberInput('')).toBeUndefined();
    expect(parseNumberInput('-')).toBeUndefined();
    expect(parseNumberInput('abc')).toBeUndefined();
  });

  it('datetime-local WIB ↔ ISO berzona +07:00, tidak bergantung zona peramban', () => {
    const iso = fromWibInput('2026-10-05T07:10');
    expect(iso).toBe('2026-10-05T07:10:00+07:00');
    expect(new Date(iso ?? '').toISOString()).toBe('2026-10-05T00:10:00.000Z');
    expect(wibInputValue(iso)).toBe('2026-10-05T07:10');
    expect(wibInputValue('2026-10-04T23:30:00.000Z')).toBe('2026-10-05T06:30');
    expect(fromWibInput('')).toBeUndefined();
    expect(fromWibInput('2026-10-05')).toBeUndefined();
    expect(wibInputValue('bukan tanggal')).toBe('');
    expect(wibInputValue(12)).toBe('');
  });
});
