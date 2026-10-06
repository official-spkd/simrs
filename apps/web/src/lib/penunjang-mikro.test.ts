import { describe, expect, it } from 'vitest';
import { demoCultures, demoPaCases } from './demo/fixtures/penunjang-mikro';
import {
  allergyFlags,
  applyCulture,
  AST_PANELS,
  type CultureCase,
  cultureStage,
  paAddendumGate,
  paSignGate,
  paStage,
} from './penunjang-mikro';

const ctx = { at: '2026-10-05T10:50:00+07:00', by: 'Sari Rahmawati, A.Md.AK' };
const culture = (id: string): CultureCase => {
  const c = demoCultures().find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
const step = (c: CultureCase, a: Parameters<typeof applyCulture>[1]) => {
  const r = applyCulture(c, a, ctx);
  if (!r.ok) throw new Error(r.code);
  return r;
};

describe('kultur bertahap', () => {
  it('tahap awal fixture', () => {
    expect(demoCultures().map(cultureStage)).toEqual(['identifikasi', 'kepekaan', 'inkubasi', 'final']);
  });

  it('urutan tidak bisa dilompati; organisme harus sesuai Gram', () => {
    const urin = culture('mk-03');
    expect(applyCulture(urin, { type: 'gram', result: 'Batang Gram negatif' }, ctx)).toEqual({
      ok: false,
      code: 'STAGE',
    });
    const darah = culture('mk-01');
    expect(applyCulture(darah, { type: 'identifikasi', organism: 'Staphylococcus aureus' }, ctx)).toEqual({
      ok: false,
      code: 'ORGANISM_MISMATCH',
    });
    expect(applyCulture(darah, { type: 'final' }, ctx)).toEqual({ ok: false, code: 'STAGE' });
  });

  it('kultur darah: Gram positif menjadi nilai kritis; kultur lain tidak', () => {
    const tumbuh = step(culture('mk-03'), { type: 'pertumbuhan', grew: true }).next;
    expect(step(tumbuh, { type: 'gram', result: 'Batang Gram negatif' }).critical).toBe(false);
    const darah = { ...culture('mk-01'), gram: null };
    expect(step(darah, { type: 'gram', result: 'Kokus Gram positif bergerombol' }).critical).toBe(true);
  });

  it('identifikasi → uji kepekaan lengkap → validasi TTE → final', () => {
    let c = step(culture('mk-01'), { type: 'identifikasi', organism: 'Escherichia coli' }).next;
    const panel = AST_PANELS['Batang Gram negatif'];
    expect(applyCulture(c, { type: 'kepekaan', results: { Ampisilin: 'R' } }, ctx)).toEqual({
      ok: false,
      code: 'AST_INCOMPLETE',
    });
    const results = Object.fromEntries(panel.map((ab) => [ab, ab === 'Ampisilin' ? 'R' : 'S'] as const));
    const r = step(c, { type: 'kepekaan', results });
    expect(r.message).toContain('resisten: Ampisilin');
    c = step(r.next, { type: 'final' }).next;
    expect(cultureStage(c)).toBe('final');
  });

  it('antibiotik yang termasuk alergi pasien ditandai (Ny. Siti Aminah alergi kotrimoksazol)', () => {
    expect(allergyFlags(culture('mk-01'))).toEqual(['Kotrimoksazol']);
    expect(allergyFlags(culture('mk-03'))).toEqual([]);
  });
});

describe('patologi anatomi', () => {
  it('TTE butuh makroskopik, mikroskopik, diagnosis; setelah TTE terkunci, koreksi lewat addendum', () => {
    const [fajar, maria] = demoPaCases();
    if (!fajar || !maria) throw new Error('pa');
    expect(paStage(fajar)).toBe('makroskopik');
    expect(paStage(maria)).toBe('diagnosis');
    expect(paSignGate(maria)).toBe('TEXT_REQUIRED');
    const done = { ...maria, diagnosis: 'Adenokarsinoma kolon berdiferensiasi sedang' };
    expect(paSignGate(done)).toBeNull();
    expect(paAddendumGate(done, 'Pewarnaan tambahan menyusul')).toBe('NOT_SIGNED');
    const signed = { ...done, signed: { at: ctx.at, by: 'dr. Hendra Wiguna, Sp.PA' } };
    expect(paSignGate(signed)).toBe('SIGNED_LOCKED');
    expect(paAddendumGate(signed, 'pendek')).toBe('TEXT_REQUIRED');
    expect(paAddendumGate(signed, 'Imunohistokimia MMR menyusul 7 hari kerja')).toBeNull();
  });
});
