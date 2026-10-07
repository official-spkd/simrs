/**
 * Kode baku di seed klinis (fase 3 · 3.0c) hanya boleh dari contoh `SEED_REF_SAMPLES` (CLAUDE.md §4.10: jangan
 * mengarang kode). Tanpa database: membandingkan konstanta seed dengan daftar contoh.
 */
import { describe, expect, it } from 'vitest';
import {
  SEED_DRUGS,
  SEED_LAB_TESTS,
  SEED_ORDERABLES,
  SEED_RADIOLOGY_PROCEDURES,
  SEED_REF_SAMPLES,
} from '../src/index';

const sampleCodes = (system: keyof typeof SEED_REF_SAMPLES) =>
  new Set(SEED_REF_SAMPLES[system].map((s) => s.code));

describe('kode seed klinis', () => {
  it('item order berkode memakai LOINC/ICD-9-CM dari contoh seed rujukan', () => {
    const unknown = SEED_ORDERABLES.filter(([, , system, code]) => system && code)
      .filter(([, , system, code]) => !sampleCodes(system as 'loinc' | 'icd9cm').has(code as string))
      .map(([, name, system, code]) => `${name} (${system} ${code})`);
    expect(unknown).toEqual([]);
  });

  it('obat ber-KFA memakai kode KFA dari contoh seed rujukan (selain itu "belum dipetakan")', () => {
    const kfa = sampleCodes('kfa');
    const unknown = SEED_DRUGS.filter((d) => d.kfa !== null && !kfa.has(d.kfa)).map(
      (d) => `${d.name} (${d.kfa})`,
    );
    expect(unknown).toEqual([]);
  });

  it('seed penunjang fase 4: LOINC tes lab dan ICD-9-CM prosedur radiologi dari contoh seed rujukan', () => {
    const loinc = sampleCodes('loinc');
    const icd9 = sampleCodes('icd9cm');
    const lab = SEED_LAB_TESTS.filter(([, , code]) => !loinc.has(code)).map(
      ([, name, code]) => `${name} (${code})`,
    );
    const rad = SEED_RADIOLOGY_PROCEDURES.filter(([, , , code]) => code !== null && !icd9.has(code)).map(
      ([, name, , code]) => `${name} (${code})`,
    );
    expect([...lab, ...rad]).toEqual([]);
  });
});
