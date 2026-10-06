import { SEED_REF_SAMPLES } from '@simrs/db';
import { isValidRefCode } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_IMPORT_FILES, DEMO_REF_CONCEPTS, LOINC_PENDING } from './demo/fixtures/terminologi';
import { applyImport, dryRunImport, parseCsv, searchConcepts, textSimilarity } from './platform-terminologi';

const concepts = [...DEMO_REF_CONCEPTS];
const file = (id: string) => {
  const f = DEMO_IMPORT_FILES.find((x) => x.id === id);
  if (!f) throw new Error(id);
  return parseCsv(f.text);
};

describe('P06 · fixture data rujukan', () => {
  it('semua kode (aktif + berkas impor bersih) diambil dari SEED_REF_SAMPLES, tidak ada kode karangan', () => {
    const seed = new Set(Object.values(SEED_REF_SAMPLES).flatMap((rows) => rows.map((r) => r.code)));
    for (const c of concepts) {
      expect(seed.has(c.code), c.code).toBe(true);
      expect(isValidRefCode(c.system, c.code), c.code).toBe(true);
    }
    for (const r of file('loinc-bersih').rows)
      expect(seed.has(r.values.code ?? ''), r.values.code).toBe(true);
    for (const [code] of LOINC_PENDING) expect(concepts.some((c) => c.code === code)).toBe(false);
  });
});

describe('P06 · pencarian', () => {
  it('kode persis, awalan kode, lalu kata di label', () => {
    expect(searchConcepts(concepts, { system: 'icd10', q: 'j18.9' })[0]).toMatchObject({
      match: 'kode',
      concept: { code: 'J18.9' },
    });
    expect(searchConcepts(concepts, { system: 'icd10', q: 'N18' }).map((h) => h.concept.code)).toEqual([
      'N18.3',
      'N18.5',
    ]);
    expect(searchConcepts(concepts, { system: 'kfa', q: 'klopidogrel' })[0]?.match).toBe('teks');
  });

  it('tahan salah ketik (trigram)', () => {
    expect(textSimilarity('pnemonia', 'Pneumonia, tidak spesifik')).toBeGreaterThan(0.35);
    const hits = searchConcepts(concepts, { system: 'icd10', q: 'pnemonia' });
    expect(hits.map((h) => h.concept.code)).toEqual(expect.arrayContaining(['J18.9', 'J13']));
    expect(hits.every((h) => h.match === 'mirip')).toBe(true);
    expect(searchConcepts(concepts, { system: 'icd10', q: 'zzzz' })).toEqual([]);
  });

  it('kode nonaktif hanya muncul bila diminta', () => {
    const off = concepts.map((c) => (c.code === 'K30' ? { ...c, active: false } : c));
    expect(searchConcepts(off, { system: 'icd10', q: 'K30' })).toEqual([]);
    expect(searchConcepts(off, { system: 'icd10', q: 'K30', includeInactive: true })).toHaveLength(1);
  });
});

describe('P06 · impor CSV', () => {
  it('CSV berkutip dan jumlah kolom salah', () => {
    const csv = parseCsv('code,display\n"J18.9","Pneumonia, tidak spesifik"\nJ13');
    expect(csv.rows[0]?.values).toEqual({ code: 'J18.9', display: 'Pneumonia, tidak spesifik' });
    expect(csv.rows[1]?.malformed).toMatch(/jumlah kolom 1/);
  });

  it('uji kering gagal tertutup: check digit LOINC salah dan kode ganda', () => {
    const r = dryRunImport(concepts, 'loinc', file('loinc-galat'), false);
    expect(r.errors).toEqual([
      { line: 11, message: expect.stringContaining('kode "718-6" tidak valid untuk LOINC') },
      { line: 12, message: 'kode 2823-3 muncul lebih dari sekali' },
    ]);
    expect(() => applyImport(concepts, r, false)).toThrow();
  });

  it('berkas bersih: 5 baru, 3 berubah, 1 tetap; versi pengganti menonaktifkan sisanya', () => {
    const r = dryRunImport(concepts, 'loinc', file('loinc-bersih'), false);
    expect(r).toMatchObject({ rows: 9, inserted: 5, updated: 3, unchanged: 1, deactivated: 0, errors: [] });
    const next = applyImport(concepts, r, false);
    expect(searchConcepts(next, { system: 'loinc', q: 'troponin' })[0]?.concept.code).toBe('10839-9');
    const replaced = dryRunImport(concepts, 'loinc', file('loinc-bersih'), true);
    expect(replaced.deactivated).toBe(9);
    const after = applyImport(concepts, replaced, true);
    expect(after.filter((c) => c.system === 'loinc' && c.active)).toHaveLength(9);
    expect(after.filter((c) => c.system === 'icd10')).toEqual(concepts.filter((c) => c.system === 'icd10'));
  });
});
