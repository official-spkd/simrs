import { SEED_REF_SAMPLES } from '@simrs/db';
import { describe, expect, it } from 'vitest';
import { screenById } from '../../screens';
import { applyAction, runScenario } from '../engine/run';
import type { ScenarioDef, ScenarioEvent } from '../engine/types';
import { SCENARIO_ORDER, SCENARIOS } from '.';

function autoplay(def: ScenarioDef): ScenarioEvent[] {
  let seq: ScenarioEvent[] = [];
  while (!runScenario(def, seq).finished) {
    const r = applyAction(def, seq, { type: 'auto' });
    if (!r.ok) throw new Error(r.error);
    seq = r.seq;
  }
  return seq;
}

const icd10 = new Set(SEED_REF_SAMPLES.icd10.map((c) => c.code));
const icd9 = new Set(SEED_REF_SAMPLES.icd9cm.map((c) => c.code));

describe('definisi skenario presentasi', () => {
  it('id langkah unik; tiap langkah menunjuk layar terdaftar yang dibuka posisi pembawanya', () => {
    for (const id of SCENARIO_ORDER) {
      const def = SCENARIOS[id];
      expect(new Set(def.steps.map((s) => s.id)).size).toBe(def.steps.length);
      for (const step of def.steps) {
        const screen = screenById(step.screen);
        expect(screen, `${id}.${step.id} → ${step.screen}`).toBeDefined();
        if (!screen || !step.role || screen.demoRoles === 'semua') continue;
        expect(screen.demoRoles, `${id}.${step.id}`).toContain(step.role);
      }
    }
  });

  it('kode diagnosis/prosedur hanya dari contoh rujukan seed (tidak ada kode karangan)', () => {
    for (const id of SCENARIO_ORDER) {
      const R = runScenario(SCENARIOS[id], autoplay(SCENARIOS[id]));
      for (const d of R.rec.dx) expect(icd10.has(d.split(' ')[0] ?? ''), d).toBe(true);
      for (const t of R.rec.tindakan) expect(icd9.has(t.split(' ')[0] ?? ''), t).toBe(true);
    }
    expect(icd10.has('I20.0')).toBe(true);
  });

  it('identitas pasien skenario berformat RM fiktif dan berbeda satu sama lain', () => {
    const rms = SCENARIO_ORDER.map((id) => SCENARIOS[id].base.rm);
    for (const rm of rms) expect(rm).toMatch(/^00-\d{2}-\d{2}-\d{2}$/);
    expect(new Set(rms).size).toBe(rms.length);
  });
});
