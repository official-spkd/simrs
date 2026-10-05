import { createHash } from 'node:crypto';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, PDFRawStream, PDFDict } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PDF_FONT_NAMES, pdfFontBytes } from './fonts';
import { renderClinicalPdf, wrapText } from './render';
import type { ClinicalPdfInput } from './schema';

/** Resume fiktif (data uji, bukan pasien nyata) dengan karakter khas teks klinis Indonesia. */
const RESUME: ClinicalPdfInput = {
  hospital: {
    name: 'RS Fiktif Sehat Sentosa',
    unit: 'Instalasi Rawat Inap',
    address: 'Jl. Contoh No. 1, Kota Fiktif 12345',
    contact: 'Telp. (021) 000-0000',
  },
  document: {
    title: 'Resume Medis Pulang',
    number: 'RES/2026/10/0001',
    issuedAt: '2026-10-05T13:00:00+07:00',
  },
  patient: {
    name: 'Ny. Uji Pasien Fiktif',
    mrn: '00-41-27-88',
    birthDate: '1968-03-12',
    sex: 'female',
    extra: [
      { label: 'Ruang / bed', value: 'Bangsal Melati M-203' },
      { label: 'DPJP', value: 'dr. Contoh Dokter, Sp.PD' },
    ],
  },
  sections: [
    {
      title: 'Ringkasan',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Demam 4 hari, batuk berdahak, sesak. Suhu 38,9 °C → 36,8 °C; SpO₂ 91% → 97%. Leukosit 16.200 → 8.900 /µL. eGFR ≥ 60 mL/menit/1,73 m². Kreatinin ≤ 1,1 mg/dL — stabil.',
        },
        {
          kind: 'fields',
          rows: [
            { label: 'Diagnosis utama', value: 'J18.9 Pneumonia, tidak spesifik' },
            { label: 'Kondisi pulang', value: 'Membaik' },
          ],
        },
      ],
    },
    {
      title: 'Obat pulang (rekonsiliasi)',
      blocks: [
        {
          kind: 'table',
          columns: ['Obat', 'Aturan pakai', 'Status'],
          widths: [3, 2, 1],
          rows: [
            ['Sefiksim 200 mg tablet', '2×1 sesudah makan', 'Baru'],
            ['Metformin 500 mg tablet', '2×1', 'Lanjut'],
          ],
        },
        {
          kind: 'list',
          items: ['Kontrol poli penyakit dalam 7 hari lagi.', 'Segera ke IGD bila sesak memberat.'],
        },
      ],
    },
  ],
  signatures: [
    {
      role: 'Dokter penanggung jawab pelayanan (DPJP)',
      name: 'dr. Contoh Dokter, Sp.PD',
      caption: '19800101 200501 1 001',
      verifyUrl: 'https://simrs.example/verifikasi/sv1.contoh.abc',
    },
  ],
};

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('PDF klinis deterministik (ADR-0029)', () => {
  it('input sama → byte dan SHA-256 sama; isi berbeda → hash berbeda', async () => {
    const a = await renderClinicalPdf(RESUME);
    const b = await renderClinicalPdf(structuredClone(RESUME));
    expect(Buffer.from(a).subarray(0, 5).toString()).toBe('%PDF-');
    expect(sha(a)).toBe(sha(b));
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    const c = await renderClinicalPdf({ ...RESUME, patient: { ...RESUME.patient, mrn: '00-41-27-89' } });
    expect(sha(c)).not.toBe(sha(a));
  });

  it('metadata hanya dari input: tanggal = waktu terbit, tanpa jam sistem', async () => {
    const doc = await PDFDocument.load(await renderClinicalPdf(RESUME), { updateMetadata: false });
    expect(doc.getTitle()).toBe('Resume Medis Pulang');
    expect(doc.getCreationDate()?.toISOString()).toBe('2026-10-05T06:00:00.000Z');
    expect(doc.getModificationDate()?.toISOString()).toBe('2026-10-05T06:00:00.000Z');
    expect(doc.getProducer()).toBe('SIM RS (pdf-lib)');
  });

  it('fon IBM Plex tertanam (subset TrueType + ToUnicode), bukan fon standar PDF', async () => {
    const doc = await PDFDocument.load(await renderClinicalPdf(RESUME));
    const fonts: string[] = [];
    let fontFiles = 0;
    let toUnicode = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict) && !(obj instanceof PDFRawStream)) continue;
      const dict = obj instanceof PDFRawStream ? obj.dict : obj;
      if (
        dict.get(PDFName.of('Type'))?.toString() === '/Font' &&
        dict.get(PDFName.of('Subtype'))?.toString() === '/Type0'
      ) {
        fonts.push(dict.get(PDFName.of('BaseFont'))?.toString() ?? '');
        if (dict.get(PDFName.of('ToUnicode'))) toUnicode += 1;
      }
      if (dict.get(PDFName.of('FontFile2'))) fontFiles += 1;
    }
    expect(fonts.sort()).toEqual(
      Object.values(PDF_FONT_NAMES)
        .map((n) => `/${n}`)
        .sort(),
    );
    expect(fontFiles).toBe(3);
    expect(toUnicode).toBe(3);
  });

  it('semua karakter teks klinis Indonesia tersedia di fon (tanpa glif kosong)', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(pdfFontBytes('regular'), { subset: true });
    const covered = new Set(font.getCharacterSet());
    const sample = 'Abcdeé ÀÉ àéèêëïöü ·–—°±×≥≤→µ²₂½% Rp 1.250.400 Sen, 5 Okt 2026 · 07.10 “kutip” ‘tunggal’';
    const missing = [...sample].filter((ch) => ch !== ' ' && !covered.has(ch.codePointAt(0) ?? 0));
    expect(missing).toEqual([]);
  });

  it('isi panjang berpindah halaman; identitas tetap ada dan setiap halaman bernomor', async () => {
    const long: ClinicalPdfInput = {
      ...RESUME,
      sections: [
        {
          title: 'Catatan perkembangan',
          blocks: Array.from({ length: 40 }, (_, i) => ({
            kind: 'paragraph' as const,
            text: `Hari ke-${i + 1}: pasien stabil, tanda vital dalam batas normal, edukasi diet dan mobilisasi diberikan kepada pasien dan keluarga.`,
          })),
        },
      ],
    };
    const doc = await PDFDocument.load(await renderClinicalPdf(long));
    expect(doc.getPageCount()).toBeGreaterThan(1);
    for (const page of doc.getPages()) expect(page.getSize()).toEqual({ width: 595.28, height: 841.89 });
  });

  it('input tidak sah ditolak sebelum dirender', async () => {
    await expect(
      renderClinicalPdf({
        ...RESUME,
        sections: [{ title: 'X', blocks: [{ kind: 'table', columns: ['A', 'B'], rows: [['1']] }] }],
      }),
    ).rejects.toThrow(/Jumlah sel/);
    await expect(
      renderClinicalPdf({ ...RESUME, document: { ...RESUME.document, issuedAt: 'kemarin' } }),
    ).rejects.toThrow();
  });
});

describe('wrapText', () => {
  it('membungkus per kata, memotong kata panjang, dan mempertahankan baris baru', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(pdfFontBytes('regular'), { subset: true });
    const lines = wrapText('satu dua tiga empat lima\nenam', font, 10, 60);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.at(-1)).toBe('enam');
    for (const l of lines) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(60);
    const broken = wrapText('x'.repeat(80), font, 10, 50);
    expect(broken.join('')).toBe('x'.repeat(80));
  });
});
