import { SEED_REF_SAMPLES } from '@simrs/db';
import { labSampleSchema, labWorklistSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, runScenario } from './demo/engine/run';
import type { ScenarioDef, ScenarioEvent, TaskValue } from './demo/engine/types';
import { demoLabWorklist } from './demo/fixtures/penunjang';
import { SCENARIOS } from './demo/skenario';
import { criticalOpen, criticalStage, sampleStatusView, validationBlock } from './penunjang';
import {
  hartonoLabSample,
  scenarioLabSamples,
  scenarioPatientMap,
  suryoLabSample,
} from './penunjang-skenario';

const RJ = SCENARIOS['rawat-jalan'];
const IGD = SCENARIOS['igd-ranap'];
const loinc = new Set(SEED_REF_SAMPLES.loinc.map((c) => c.code));

function stepOf(def: ScenarioDef, id: string): number {
  return def.steps.findIndex((s) => s.id === id);
}

/** Lompat ke awal langkah `stepId` (tugas sebelumnya dikerjakan dengan nilai bawaan). */
function at(def: ScenarioDef, stepId: string): ScenarioEvent[] {
  const r = advanceTo(def, [], stepOf(def, stepId));
  if (!r.ok) throw new Error(r.error);
  return r.seq;
}

/** Kerjakan tugas `task` di langkah aktif. */
function act(def: ScenarioDef, seq: ScenarioEvent[], task: string, value: TaskValue = true): ScenarioEvent[] {
  const R = runScenario(def, seq);
  const r = applyAction(def, seq, { type: 'task', step: R.step, task, value });
  if (!r.ok) throw new Error(`${task}: ${r.error}`);
  return r.seq;
}

describe('Tn. Suryo (rawat jalan) di worklist lab', () => {
  it('belum ada sebelum order CPOE; muncul menunggu sampling setelah pemeriksaan-dokter.order', () => {
    const beforeOrder = act(RJ, act(RJ, at(RJ, 'pemeriksaan-dokter'), 'panggil'), 'dx');
    expect(suryoLabSample(runScenario(RJ, beforeOrder))).toBeNull();
    const s = suryoLabSample(runScenario(RJ, at(RJ, 'laboratorium')));
    expect(s).toMatchObject({ labNo: 'L2610050088', status: 'order', receivedAt: null, results: [] });
    expect(s?.tests).toBe('HbA1c, profil lipid, kreatinin');
    expect(s && labSampleSchema.parse(s)).toBeTruthy();
  });

  it('sampling → hasil (HbA1c 8,4 H, LDL 142 H, kreatinin 1,1 · eGFR 74) → validasi', () => {
    let seq = act(RJ, at(RJ, 'laboratorium'), 'sampling');
    let s = suryoLabSample(runScenario(RJ, seq));
    expect(s?.status).toBe('diterima');
    expect(s?.results.every((r) => r.pending)).toBe(true);
    expect(s && validationBlock(s)).toBe('Belum ada hasil untuk divalidasi.');

    seq = act(RJ, seq, 'hasil');
    s = suryoLabSample(runScenario(RJ, seq));
    const byCode = (c: string) => s?.results.find((r) => r.loinc === c);
    expect(s?.status).toBe('hasil');
    expect(byCode('4548-4')).toMatchObject({ value: 8.4, flag: 'H' });
    expect(byCode('13457-7')).toMatchObject({ value: 142, flag: 'H' });
    expect(byCode('2160-0')).toMatchObject({ value: 1.1, flag: 'N' });
    expect(byCode('2160-0')?.note).toContain('eGFR 74');
    expect(s?.results.map((r) => r.loinc).sort()).toEqual([
      '13457-7',
      '2085-9',
      '2093-3',
      '2160-0',
      '2571-8',
      '4548-4',
    ]);
    for (const r of s?.results ?? []) expect(loinc.has(r.loinc)).toBe(true);

    seq = act(RJ, seq, 'validasi');
    s = suryoLabSample(runScenario(RJ, seq));
    expect(s?.status).toBe('selesai');
    expect(s?.clinical?.by).toBe('dr. Maya Lestari, Sp.PK');
    expect(s && sampleStatusView(s).label).toBe('Selesai');
  });

  it('order "HbA1c saja" hanya membawa HbA1c', () => {
    const seq = act(RJ, act(RJ, act(RJ, at(RJ, 'pemeriksaan-dokter'), 'panggil'), 'dx'), 'order', 'hba1c');
    expect(suryoLabSample(runScenario(RJ, seq))?.tests).toBe('HbA1c');
  });
});

describe('Tn. Hartono (IGD) dan nilai kritis', () => {
  it('belum ada sebelum order set; cito diproses setelah asesmen-dokter.orderset', () => {
    expect(hartonoLabSample(runScenario(IGD, at(IGD, 'asesmen-dokter')))).toBeNull();
    const s = hartonoLabSample(runScenario(IGD, at(IGD, 'nilai-kritis')));
    expect(s).toMatchObject({ labNo: 'L2610030188', priority: 'cito', status: 'diterima', critical: null });
  });

  it('nilai-kritis: banner kritis terbuka (kalium 6,8) → lapor → read-back; waktu lapor 5 menit', () => {
    let seq = act(IGD, at(IGD, 'nilai-kritis'), 'hasil');
    let s = hartonoLabSample(runScenario(IGD, seq));
    expect(s?.results.find((r) => r.loinc === '2823-3')).toMatchObject({ value: 6.8, flag: 'KRITIS' });
    expect(s?.results.find((r) => r.loinc === '10839-9')?.flag).toBe('H');
    expect(s?.results.find((r) => r.loinc === '2160-0')?.note).toContain('eGFR 38');
    expect(s && criticalOpen(s)).toBe(true);
    expect(s?.critical).toMatchObject({ limitMinutes: 30, elapsedSeconds: 0, recipient: null });
    expect(s && validationBlock(s)).toMatch(/Laporkan nilai kritis/);

    seq = act(IGD, seq, 'lapor', 'dr. Rina Kusuma (dokter jaga IGD)');
    s = hartonoLabSample(runScenario(IGD, seq));
    expect(s?.critical && criticalStage(s.critical)).toBe('menunggu-read-back');
    expect(s?.critical).toMatchObject({
      recipient: 'dr. Rina Kusuma (dokter jaga IGD)',
      elapsedSeconds: 240,
    });

    seq = act(IGD, seq, 'readback');
    s = hartonoLabSample(runScenario(IGD, seq));
    expect(s?.critical && criticalStage(s.critical)).toBe('selesai');
    expect(s?.critical?.minutesToReport).toBe(5);
    expect(s && validationBlock(s)).toBeNull();
  });

  it('mesin menolak laporan tanpa nama penerima yang sah', () => {
    const seq = act(IGD, at(IGD, 'nilai-kritis'), 'hasil');
    const R = runScenario(IGD, seq);
    const r = applyAction(IGD, seq, { type: 'task', step: R.step, task: 'lapor', value: 'dr' });
    expect(r.ok).toBe(false);
  });
});

describe('worklist dengan pasien skenario', () => {
  it('lolos kontrak; pasien skenario dipetakan ke skenarionya', () => {
    const results = {
      'rawat-jalan': runScenario(RJ, at(RJ, 'laboratorium')),
      'igd-ranap': runScenario(IGD, act(IGD, at(IGD, 'nilai-kritis'), 'hasil')),
      'elektif-btn': runScenario(SCENARIOS['elektif-btn'], []),
    };
    const w = labWorklistSchema.parse(demoLabWorklist(scenarioLabSamples(results)));
    expect(w.samples).toHaveLength(10);
    expect(
      w.samples
        .filter(criticalOpen)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['lab-hartono', 'lab-yusuf']);
    expect(scenarioPatientMap()).toMatchObject({ 'ps-suryo': 'rawat-jalan', 'ps-hartono': 'igd-ranap' });
  });
});
