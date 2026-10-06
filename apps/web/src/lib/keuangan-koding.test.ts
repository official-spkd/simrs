import { describe, expect, it } from 'vitest';
import { BERKAS_KODING, BUKTI_RME } from './demo/fixtures/koding';
import { ICD9_NAME, ICD10_NAME } from './demo/fixtures/keuangan';
import {
  applyAnswer,
  type BerkasKoding,
  codeStatus,
  effectiveCode,
  validateBerkas,
  versionProblem,
} from './keuangan-koding';

const berkas = (id: string): BerkasKoding => {
  const b = BERKAS_KODING.find((x) => x.id === id);
  if (!b) throw new Error(id);
  return b;
};

describe('data dummy workbench koder', () => {
  it('semua kode (termasuk saran) dari contoh seed ICD-10/ICD-9-CM; tiap berkas punya satu diagnosis utama', () => {
    for (const b of BERKAS_KODING) {
      for (const c of b.codes) {
        const ref = c.system === 'ICD-10' ? ICD10_NAME : ICD9_NAME;
        expect(ref[c.code], `${b.id} ${c.code}`).toBe(c.name);
        if (c.suggestion) expect(ICD10_NAME[c.suggestion.code]).toBe(c.suggestion.name);
      }
      expect(b.codes.filter((c) => c.role === 'utama')).toHaveLength(1);
    }
  });

  it('keadaan awal: setiap berkas punya pekerjaan yang terlihat', () => {
    expect(validateBerkas(berkas('kb-yusuf'))).toEqual([
      'putuskan saran kode J18.9',
      'tautkan bukti atau tulis alasan untuk N17.9',
    ]);
    expect(validateBerkas(berkas('kb-aminah'))).toEqual([
      'tautkan bukti atau tulis alasan untuk R57.2',
      'tunggu jawaban query DPJP',
    ]);
    expect(validateBerkas(berkas('kb-joko'))).toEqual(['tautkan bukti atau tulis alasan untuk E87.5']);
    expect(BUKTI_RME['kb-joko']?.some((b) => b.label.includes('Kalium'))).toBe(true);
  });
});

describe('aturan koding', () => {
  const y = berkas('kb-yusuf');

  it('saran diterima → kode spesifik dengan buktinya; bukti tertaut atau alasan ≥ 10 meluluskan kode', () => {
    const [j18, , n17] = y.codes;
    if (!j18?.suggestion || !n17) throw new Error('fixture');
    const accepted = { ...j18, suggestion: { ...j18.suggestion, decided: 'terima' as const } };
    expect(codeStatus(accepted)).toBe('valid');
    expect(effectiveCode(accepted).code).toBe('J13');
    expect(codeStatus(n17)).toBe('perlu-bukti');
    expect(codeStatus({ ...n17, keepReason: 'pendek' })).toBe('perlu-bukti');
    expect(codeStatus({ ...n17, keepReason: 'Klinis jelas di CPPT DPJP' })).toBe('valid');
    const linked = { ...n17, evidence: BUKTI_RME['kb-yusuf']?.[0] ?? null };
    expect(validateBerkas({ ...y, codes: [accepted, y.codes[1]!, linked, ...y.codes.slice(3)] })).toEqual([]);
  });

  it('jawaban DPJP menautkan addendum resume ke kode yang dikonfirmasi', () => {
    const a = applyAnswer(berkas('kb-aminah'), 'Ya, syok septik', '2026-10-05T10:50:00+07:00');
    expect(a.query?.answer).toBe('Ya, syok septik');
    expect(a.codes.find((c) => c.code === 'R57.2')?.evidence?.source).toBe('addendum');
    expect(validateBerkas(a)).toEqual([]);
  });

  it('berkas terkirim: perubahan = versi baru beralasan; diagnosis utama dihapus terdeteksi', () => {
    expect(versionProblem(berkas('kb-joko'), 'hapus')).toMatch(/10 lagi/);
    expect(versionProblem(berkas('kb-joko'), 'Kalium tidak bermakna klinis')).toBeNull();
    expect(versionProblem(y, '')).toBeNull();
    const noMain = { ...y, codes: y.codes.map((c) => (c.role === 'utama' ? { ...c, removed: true } : c)) };
    expect(validateBerkas(noMain)[0]).toBe('harus tepat satu diagnosis utama (ada 0)');
  });
});
