import { type FormSchema, formSchemaSchema, MORSE_FALL_SCALE } from '@simrs/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormRenderer, type FormRendererProps } from './form-renderer';

/**
 * Struktur markup penyaji formulir P07 (render server, tanpa DOM): label terlihat dan terhubung ke kontrol, penanda
 * wajib terbaca pembaca layar, galat terhubung lewat `aria-describedby`, logika tampil, skor dengan kategori teks,
 * dan mode hanya baca. Interaksi diuji lewat logika murni `lib/form-renderer.test.ts`.
 */

const SCHEMA: FormSchema = formSchemaSchema.parse({
  sections: [
    {
      title: 'Pengkajian awal',
      description: 'Diisi saat pasien masuk.',
      fields: [
        { key: 'keluhan', type: 'textarea', label: 'Keluhan utama', required: true },
        { key: 'suhu', type: 'number', label: 'Suhu', unit: '°C', min: 30, max: 45 },
        {
          key: 'rujukan',
          type: 'single',
          label: 'Datang dengan rujukan?',
          options: [
            { value: 'tidak', label: 'Tidak' },
            { value: 'ya', label: 'Ya' },
          ],
        },
        {
          key: 'asal',
          type: 'text',
          label: 'Asal rujukan',
          showWhen: { field: 'rujukan', equals: 'ya' },
        },
        { key: 'dx', type: 'icd10', label: 'Diagnosis kerja' },
        { key: 'ttd', type: 'signature', label: 'Tanda tangan perawat', required: true },
      ],
    },
  ],
});

const noop = () => undefined;

/** Render server penyaji (tes vitest web tanpa transformasi JSX). */
const render = (props: FormRendererProps) => renderToStaticMarkup(createElement(FormRenderer, props));

describe('FormRenderer', () => {
  it('label terlihat terhubung ke kontrol; wajib ditandai teks untuk pembaca layar', () => {
    const html = render({ schema: SCHEMA, answers: {}, onChange: noop });
    expect(html).toContain('<legend');
    expect(html).toContain('Pengkajian awal');
    expect(html).toContain('Diisi saat pasien masuk.');
    const id = /<label for="([^"]+)"[^>]*>Keluhan utama/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<textarea id="${id}"`);
    expect(html).toContain('(wajib)');
    expect(html).toContain('°C');
    expect(html).toContain('Rentang 30–45 °C');
    // Tanda tangan = ketik nama penanda tangan.
    expect(html).toContain('Ketik nama lengkap penanda tangan');
  });

  it('logika tampil: field turunan hanya tampil bila jawaban induk cocok', () => {
    const hidden = render({ schema: SCHEMA, answers: { rujukan: 'tidak' }, onChange: noop });
    expect(hidden).not.toContain('Asal rujukan');
    const shown = render({ schema: SCHEMA, answers: { rujukan: 'ya' }, onChange: noop });
    expect(shown).toContain('Asal rujukan');
    const ya = /<input[^>]*value="ya"[^>]*>/.exec(shown)?.[0] ?? '';
    expect(ya).toContain('type="radio"');
    expect(ya).toContain('checked');
  });

  it('galat per field: kontrol ditandai invalid dan pesan terhubung lewat aria-describedby', () => {
    const html = render({
      schema: SCHEMA,
      answers: { dx: 'X' },
      onChange: noop,
      errors: { dx: 'Kode ICD-10 tidak valid' },
    });
    const m = /<input id="([^"]+)" aria-describedby="([^"]+)" aria-invalid="true"[^>]*value="X"/.exec(html);
    expect(m).toBeTruthy();
    expect(html).toContain(`id="${m?.[2]}" class="text-caption text-danger">Kode ICD-10 tidak valid`);
  });

  it('skor Morse: total + kategori sebagai teks dan aturan tindak lanjut saat kategori tertinggi', () => {
    const answers = {
      q_riwayat_jatuh: 'ya',
      q_diag_sekunder: 'ya',
      q_alat_bantu: 'tidak_ada',
      q_infus: 'tidak',
      q_gaya_jalan: 'lemah',
      q_mental: 'sadar',
    };
    const html = render({ schema: MORSE_FALL_SCALE.schema, answers, onChange: noop });
    expect(html).toContain('>50<');
    expect(html).toContain('Risiko tinggi');
    expect(html).toContain('6 dari 6 pertanyaan terjawab');
    expect(html).toContain('Tindak lanjut: Skor ≥ 45');
    expect(html).toContain('+25');
  });

  it('hanya baca: jawaban tampil sebagai label opsi, tanpa kontrol isian', () => {
    const html = render({ schema: SCHEMA, answers: { keluhan: 'Demam 3 hari', suhu: 38.2, rujukan: 'ya' } });
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<textarea');
    expect(html).toContain('Demam 3 hari');
    expect(html).toContain('38.2 °C');
    expect(html).toContain('<dd class="m-0 text-small text-ink-900">Ya</dd>');
    expect(html).toContain('Asal rujukan');
  });
});
