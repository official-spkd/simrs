import { EDUCATION_FORM_SAMPLE, type EncounterEducation, formSchemaSchema } from '@simrs/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { educationHref, MISSING_LABEL } from '@/app/(perangkat)/tablet/persetujuan/consent-status';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/server/data/klinis/edukasi-actions', () => ({ saveEducationAction: vi.fn() }));

const ENC = '0199a000-0000-7000-8000-0000000000e1';
const data = (over: Partial<EncounterEducation> = {}): EncounterEducation => ({
  encounterId: ENC,
  patientId: '0199a000-0000-7000-8000-0000000000a1',
  form: {
    code: 'edukasi_terintegrasi',
    title: EDUCATION_FORM_SAMPLE.title,
    version: 2,
    schema: formSchemaSchema.parse(EDUCATION_FORM_SAMPLE.schema),
  },
  supportsConsent: true,
  ready: false,
  records: [],
  ...over,
});

describe('edukasi mode api (K11) dan tablet persetujuan', () => {
  it('label kekurangan terbaca setelah "Menunggu …"; tautan ke layar Edukasi kunjungan + draf', () => {
    expect(`Menunggu ${MISSING_LABEL.edukasi_tindakan}.`).toBe(
      'Menunggu edukasi tindakan dinyatakan paham (isi Edukasi terintegrasi, topik tindakan).',
    );
    expect(educationHref({ id: 'd1', encounterId: ENC })).toBe(`/klinis/edukasi?kunjungan=${ENC}&draf=d1`);
  });

  it('status syarat, formulir P07 bertopik tindakan, riwayat berlabel opsi', async () => {
    const { EducationApi } = await import('@/components/klinis/education-api');
    const html = (d: EncounterEducation, canWrite = true) =>
      renderToStaticMarkup(
        createElement(EducationApi, { data: d, canWrite, backHref: '/tablet/persetujuan/x' }),
      );
    const empty = html(data());
    expect(empty).toContain('Belum dinyatakan paham');
    expect(empty).toContain('Tindakan yang direncanakan: manfaat, risiko, alternatif');
    expect(empty).toContain('Kembali ke tablet persetujuan');
    const done = html(
      data({
        ready: true,
        records: [
          {
            id: '0199a000-0000-7000-8000-0000000000f1',
            version: 1,
            createdAt: '2026-10-07T02:00:00.000Z',
            author: 'Ns. Fiktif',
            answers: { topik: ['tindakan'], sasaran: 'keduanya', evaluasi: 'paham' },
          },
        ],
      }),
      false,
    );
    expect(done).toContain('Terverifikasi paham');
    expect(done).toContain('Memahami, bisa mengulang');
    expect(done).toContain('Topik tindakan');
    expect(done).not.toContain('Simpan edukasi');
  });
});
