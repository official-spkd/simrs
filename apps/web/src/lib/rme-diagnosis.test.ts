import { SEED_REF_SAMPLES } from '@simrs/db';
import { describe, expect, it } from 'vitest';
import {
  allergyList,
  encounterCoding,
  problemList,
  RME_ICD10,
  RME_ICD9,
} from './demo/fixtures/rme-diagnosis';
import { chartPatient, demoRmeCharts } from './demo/fixtures/rme-pasien';
import {
  activeAllergies,
  addAllergyBlocker,
  addDxBlocker,
  type AllergyEntry,
  canEditAllergy,
  canEditDiagnosis,
  current,
  type EncounterDx,
  finalizeBlocker,
  finalizeDx,
  markAllergyError,
  markDxError,
  nkdaBlocker,
  primaryDx,
  resolveProblem,
  setPrimary,
} from './rme-diagnosis';

const AT = '2026-10-05T10:50:00+07:00';
const dx = (id: string, code: string, rank: EncounterDx['rank']): EncounterDx => ({
  id,
  version: 1,
  supersedesId: null,
  by: 'dr. A',
  at: AT,
  code,
  display: code,
  rank,
  certainty: 'kerja',
  status: 'aktif',
  reason: null,
});
const ids = (n: number) => `baru-${n}`;

describe('diagnosis dan problem list (K08)', () => {
  it('kode ICD-10/ICD-9-CM hanya dari rujukan seed, label sama', () => {
    const seed10 = new Map(SEED_REF_SAMPLES.icd10.map((c) => [c.code, c.display]));
    const seed9 = new Map(SEED_REF_SAMPLES.icd9cm.map((c) => [c.code, c.display]));
    for (const c of RME_ICD10) expect(seed10.get(c.code), c.code).toBe(c.display);
    for (const c of RME_ICD9) expect(seed9.get(c.code), c.code).toBe(c.display);
    for (const chart of demoRmeCharts()) {
      const { dx: list, procedures } = encounterCoding(chart);
      for (const d of list) expect(seed10.has(d.code), d.code).toBe(true);
      for (const p of procedures) expect(seed9.has(p.code), p.code).toBe(true);
      for (const p of problemList(chart, list)) expect(seed10.has(p.code), p.code).toBe(true);
      expect(primaryDx(list).length, chart.encounterId).toBeLessThanOrEqual(1);
    }
  });

  it('tepat satu diagnosis utama: utama kedua ditolak, kode ganda ditolak', () => {
    const list = [dx('a', 'J18.9', 'utama')];
    expect(addDxBlocker(list, 'E11.9', 'utama')).toMatch(/Diagnosis utama sudah ada \(J18\.9\)/);
    expect(addDxBlocker(list, 'J18.9', 'sekunder')).toMatch(/sudah tercatat/);
    expect(addDxBlocker(list, 'E11.9', 'sekunder')).toBeNull();
    expect(addDxBlocker(list, '', 'sekunder')).toBe('Pilih kode ICD-10.');
  });

  it('jadikan utama = dua versi baru; versi lama digantikan', () => {
    const list = [dx('a', 'J18.9', 'utama'), dx('b', 'E11.9', 'sekunder')];
    const added = setPrimary(list, 'b', 'dr. B', AT, ids);
    expect(added.map((d) => [d.code, d.rank, d.version, d.supersedesId])).toEqual([
      ['J18.9', 'sekunder', 2, 'a'],
      ['E11.9', 'utama', 2, 'b'],
    ]);
    const all = [...list, ...added];
    expect(primaryDx(all).map((d) => d.code)).toEqual(['E11.9']);
    expect(current(all)).toHaveLength(2);
  });

  it('salah entri beralasan; diagnosis akhir butuh tepat satu utama', () => {
    const a = dx('a', 'J18.9', 'utama');
    expect(() => markDxError(a, 'pendek', 'x', AT, 'v')).toThrow(/minimal 10/);
    const voided = markDxError(a, 'Salah pilih kode diagnosis', 'x', AT, 'v');
    expect(voided).toMatchObject({ status: 'salah-entri', version: 2, supersedesId: 'a' });
    expect(finalizeBlocker([a, voided])).toMatch(/Belum ada diagnosis utama/);
    const ok = [a, dx('b', 'E11.9', 'sekunder')];
    expect(finalizeBlocker(ok)).toBeNull();
    const fin = finalizeDx(ok, 'dr. A', AT, ids);
    expect(fin.every((d) => d.certainty === 'akhir')).toBe(true);
    expect(finalizeBlocker([...ok, ...fin])).toBe('Diagnosis akhir sudah ditetapkan.');
  });

  it('masalah teratasi = versi baru bertanggal', () => {
    const p = problemList(demoRmeCharts()[0] ?? (undefined as never), [])[0];
    if (!p) throw new Error('problem list kosong');
    const r = resolveProblem(p, {
      resolvedOn: '2026-10-05',
      note: 'Klinis membaik',
      by: 'x',
      at: AT,
      id: 'r',
    });
    expect(r).toMatchObject({ status: 'teratasi', resolvedOn: '2026-10-05', version: 2, supersedesId: p.id });
    expect(() =>
      resolveProblem(r, { resolvedOn: '2026-10-05', note: '', by: 'x', at: AT, id: 'r2' }),
    ).toThrow();
  });

  it('alergi: wajib zat + reaksi, ganda ditolak, NKDA hanya bila tidak ada alergi aktif', () => {
    const chart = demoRmeCharts()[0];
    if (!chart) throw new Error('chart');
    const { list, nkdaAt } = allergyList(chart, chartPatient(chart).alergi);
    expect(list.map((a) => a.substance)).toEqual(['Amoksisilin']);
    expect(nkdaAt).toBeNull();
    expect(addAllergyBlocker(list, 'amoksisilin', 'ruam')).toMatch(/sudah tercatat/);
    expect(addAllergyBlocker(list, 'Ibuprofen', '')).toMatch(/reaksi/);
    expect(nkdaBlocker(list)).toMatch(/1 alergi aktif/);
    const first = list[0] as AllergyEntry;
    const voided = markAllergyError(first, 'Tercatat pada pasien yang salah', 'x', AT, 'v');
    expect(activeAllergies([...list, voided])).toEqual([]);
    expect(nkdaBlocker([...list, voided])).toBeNull();
  });

  it('hak ubah: diagnosis dokter; alergi juga perawat/bidan', () => {
    expect(canEditDiagnosis('dokter_residen')).toBe(true);
    expect(canEditDiagnosis('perawat')).toBe(false);
    expect(canEditAllergy('perawat')).toBe(true);
    expect(canEditAllergy('kasir')).toBe(false);
  });
});
