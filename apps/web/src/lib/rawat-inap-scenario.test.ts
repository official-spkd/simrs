import { SEED_REF_SAMPLES } from '@simrs/db';
import { cpptEntrySchema, cpptNoteInputSchema, inpatientDetailSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, runScenario } from './demo/engine/run';
import type { ScenarioEvent, TaskValue } from './demo/engine/types';
import { demoInpatients } from './demo/fixtures/rawat-inap';
import { SCENARIOS } from './demo/skenario';
import { correctCpptEntry, cpptMatches, ewsLevel, ewsScore, newCpptEntry, supersededIds } from './rawat-inap';
import { hartonoInpatient, ratnaInpatient, stepIndexOf } from './rawat-inap-scenario';

const icd10 = new Set(SEED_REF_SAMPLES.icd10.map((c) => c.code));
const icd9 = new Set(SEED_REF_SAMPLES.icd9cm.map((c) => c.code));

function play(
  id: keyof typeof SCENARIOS,
  tasks: Array<[string, TaskValue] | 'next'>,
  seq: ScenarioEvent[] = [],
) {
  const def = SCENARIOS[id];
  let cur = seq;
  for (const t of tasks) {
    const R = runScenario(def, cur);
    const r =
      t === 'next'
        ? applyAction(def, cur, { type: 'next' })
        : applyAction(def, cur, { type: 'task', step: R.step, task: t[0], value: t[1] });
    if (!r.ok) throw new Error(`${String(t)}: ${r.error}`);
    cur = r.seq;
  }
  return cur;
}

function jump(id: keyof typeof SCENARIOS, stepId: string): ScenarioEvent[] {
  const def = SCENARIOS[id];
  const r = advanceTo(def, [], stepIndexOf(runScenario(def, []), stepId));
  if (!r.ok) throw new Error(r.error);
  return r.seq;
}

describe('K04/K07/K12 · rawat inap', () => {
  it('pasien rawat inap lolos kontrak ketat; kode diagnosis/prosedur ⊂ seed', () => {
    for (const d of demoInpatients()) {
      expect(() => inpatientDetailSchema.parse(d)).not.toThrow();
      expect(d.medications.length).toBeGreaterThanOrEqual(2);
      for (const c of d.summary.diagnoses) {
        expect(c.system === 'ICD-10' ? icd10.has(c.code) : icd9.has(c.code)).toBe(true);
      }
    }
    const endang = demoInpatients().find((d) => d.summary.encounterId === 'kj-endang');
    expect(endang?.medications).toHaveLength(7);
    expect(endang?.summary.day).toBe(5);
  });

  it('koreksi CPPT membuat versi baru yang menunjuk entri lama; entri lama tidak berubah', () => {
    const at = '2026-10-05T11:00:00+07:00';
    const v1 = newCpptEntry({
      id: 'c1',
      encounterId: 'kj-endang',
      role: 'perawat',
      author: 'Ns. Uji',
      at,
      soap: { s: 'Nyeri', o: 'SpO2 69%', a: 'Masalah', p: '' },
    });
    const snapshot = structuredClone(v1);
    const v2 = correctCpptEntry([v1], 'c1', {
      id: 'c2',
      author: 'Ns. Uji',
      role: 'perawat',
      at,
      soap: { s: 'Nyeri', o: 'SpO2 96%', a: 'Masalah', p: '' },
      reason: 'Salah ketik nilai SpO2',
    });
    expect(v2).toMatchObject({ version: 2, supersedesId: 'c1', correctionReason: 'Salah ketik nilai SpO2' });
    expect(v1).toEqual(snapshot);
    expect(() => cpptEntrySchema.parse(v2)).not.toThrow();
    expect(supersededIds([v1, v2]).has('c1')).toBe(true);
    expect(() =>
      correctCpptEntry([v1, v2], 'c1', {
        id: 'c4',
        author: 'Ns. Uji',
        role: 'perawat',
        at,
        soap: v2,
        reason: 'Koreksi lagi versi lama',
      }),
    ).toThrow();
    expect(() =>
      correctCpptEntry([v1], 'c1', {
        id: 'c3',
        author: 'x',
        role: 'perawat',
        at,
        soap: v1,
        reason: 'pendek',
      }),
    ).toThrow();
    const bad = {
      encounterId: 'kj-endang',
      s: 'a',
      o: '',
      a: 'b',
      p: '',
      supersedesId: 'c1',
      correctionReason: null,
    };
    expect(cpptNoteInputSchema.safeParse(bad).success).toBe(false);
    expect(cpptEntrySchema.safeParse({ ...v2, correctionReason: null }).success).toBe(false);
    expect(newCpptEntry({ ...v1, at, soap: v1, role: 'residen' }).cosignRequired).toBe(true);
    expect(cpptMatches({ role: 'bidan' }, 'perawat')).toBe(true);
  });

  it('EWS dewasa dihitung dari tanda vital; tingkat dan tindak lanjut', () => {
    expect(
      ewsScore({ temp: 37.6, hr: 92, rr: 22, sbp: 128, spo2: 95, onOxygen: false, consciousness: 'A' }),
    ).toBe(4);
    expect(
      ewsScore({ temp: 38.4, hr: 112, rr: 24, sbp: 96, spo2: 93, onOxygen: true, consciousness: 'A' }),
    ).toBe(11);
    expect(ewsLevel(4).level).toBe('rendah');
    expect(ewsLevel(5).level).toBe('sedang');
    expect(ewsLevel(7).level).toBe('tinggi');
  });

  it('Tn. Hartono masuk rawat inap setelah serah terima; CPPT bertambah mengikuti lompatan hari', () => {
    const def = SCENARIOS['igd-ranap'];
    expect(hartonoInpatient(runScenario(def, jump('igd-ranap', 'admisi')))).toBeNull();
    const start = jump('igd-ranap', 'rawat-inap');
    const d0 = hartonoInpatient(runScenario(def, start));
    expect(d0).not.toBeNull();
    expect(() => inpatientDetailSchema.parse(d0)).not.toThrow();
    expect(d0?.summary).toMatchObject({ bed: 'ICU 3', wardCode: 'ICU', scenario: true });
    expect(d0?.summary.flags).toContain('cosign');
    expect(d0?.medications.find((m) => m.kfa === '93002210')?.slots[1]?.state).toBe('jadwal');

    const after = play(
      'igd-ranap',
      [
        ['emar', true],
        ['h1', true],
        ['echo', true],
        ['pindah', true],
      ],
      start,
    );
    const d1 = hartonoInpatient(runScenario(def, after));
    expect(d1?.summary).toMatchObject({ bed: 'A-12', wardCode: 'ANGGREK' });
    expect(d1?.cppt.length).toBeGreaterThan(d0?.cppt.length ?? 0);
    expect(d1?.cppt.find((c) => c.role === 'residen')?.cosignedBy).not.toBeNull();
    expect(d1?.medications.find((m) => m.kfa === '93002210')?.slots[1]?.state).toBe('diberikan');
    expect(d1?.summary.diagnoses.map((x) => x.code)).toEqual(expect.arrayContaining(['I21.4', '88.72']));
    for (const c of d1?.summary.diagnoses ?? []) {
      expect(c.system === 'ICD-10' ? icd10.has(c.code) : icd9.has(c.code)).toBe(true);
    }
  });

  it('Ny. Ratna dirawat sejak SEP; pasca operasi menambah prosedur 51.23', () => {
    const def = SCENARIOS['elektif-btn'];
    expect(ratnaInpatient(runScenario(def, []))).toBeNull();
    const post = jump('elektif-btn', 'pasca-operasi');
    const d = ratnaInpatient(runScenario(def, post));
    expect(() => inpatientDetailSchema.parse(d)).not.toThrow();
    expect(d?.summary.diagnoses.map((x) => x.code)).toEqual(['K80.2', '51.23']);
    expect(d?.summary.bed).toBe('VIP 3');
  });
});
