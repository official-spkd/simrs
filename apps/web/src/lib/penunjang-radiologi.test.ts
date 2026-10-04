import { SEED_REF_SAMPLES } from '@simrs/db';
import { radiologyWorklistSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, runScenario } from './demo/engine/run';
import type { ScenarioDef, ScenarioEvent, TaskValue } from './demo/engine/types';
import { demoRadiologyExams, demoRadiologyWorklist, RADIOLOG } from './demo/fixtures/penunjang';
import { SCENARIOS } from './demo/skenario';
import {
  applyRadLocal,
  doseError,
  parseDecimal,
  procedureCodeText,
  RAD_EXAM_UNKNOWN,
  radFinishGate,
  radSignGate,
  radStartGate,
  reportError,
  slotView,
  sortExams,
  startError,
  templateFor,
} from './penunjang-radiologi';
import { hartonoChestXray, scenarioRadiologyExams } from './penunjang-skenario-radiologi';

const icd9 = new Set(SEED_REF_SAMPLES.icd9cm.map((c) => c.code));
const IGD = SCENARIOS['igd-ranap'];
const byId = (id: string) => {
  const e = demoRadiologyExams().find((x) => x.id === id);
  if (!e) throw new Error(id);
  return e;
};

function at(def: ScenarioDef, stepId: string): ScenarioEvent[] {
  const r = advanceTo(
    def,
    [],
    def.steps.findIndex((s) => s.id === stepId),
  );
  if (!r.ok) throw new Error(r.error);
  return r.seq;
}
function act(def: ScenarioDef, seq: ScenarioEvent[], task: string, value: TaskValue = true): ScenarioEvent[] {
  const r = applyAction(def, seq, { type: 'task', step: runScenario(def, seq).step, task, value });
  if (!r.ok) throw new Error(`${task}: ${r.error}`);
  return r.seq;
}

describe('data dummy radiologi', () => {
  it('lolos kontrak ketat; 9 pemeriksaan, nomor akses unik, semua status terwakili', () => {
    const w = radiologyWorklistSchema.parse(demoRadiologyWorklist());
    expect(w.exams).toHaveLength(9);
    expect(new Set(w.exams.map((e) => e.accession)).size).toBe(9);
    expect(new Set(w.exams.map((e) => e.status))).toEqual(
      new Set(['terjadwal', 'berlangsung', 'ekspertise', 'ditandatangani']),
    );
    expect(w.modalities.map((m) => m.modality)).toEqual(['CT', 'DR', 'USG', 'MRI', 'ANGIO']);
  });

  it('kode prosedur hanya dari seed ICD-9-CM (87.03, 88.76, 88.56); selebihnya belum dipetakan', () => {
    const codes = demoRadiologyExams().map((e) => e.procedureCode);
    for (const c of codes) if (c) expect(icd9.has(c), c).toBe(true);
    expect(new Set(codes.filter(Boolean))).toEqual(new Set(['87.03', '88.76', '88.56']));
    expect(procedureCodeText(null)).toBe('kode belum dipetakan');
    expect(procedureCodeText('87.03')).toBe('ICD-9-CM 87.03');
  });

  it('CT yang sudah ditandatangani mencatat dosis; laporan oleh radiolog fiktif', () => {
    const ct = byId('rad-lestiani');
    expect(ct.dose).toEqual({ ctdiVol: 52, dlp: 880 });
    expect(ct.report?.radiologist).toBe(RADIOLOG);
    expect(RADIOLOG).toBe('dr. Arman Siregar, Sp.Rad');
    expect(
      slotView({
        modality: 'CT',
        name: 'CT',
        room: 'CT 1',
        status: 'siap',
        slotsTotal: 18,
        slotsUsed: 13,
        nextSlot: null,
      }),
    ).toEqual({
      text: '13/18 slot',
      percent: 72,
      full: false,
    });
  });
});

describe('gerbang radiologi', () => {
  it('mulai: identitas 2 penanda, dan skrining kontras untuk pemeriksaan berkontras', () => {
    expect(startError({ contrast: false }, false, false)).toMatch(/identitas/);
    expect(startError({ contrast: false }, true, false)).toBeNull();
    expect(startError({ contrast: true }, true, false)).toMatch(/Skrining kontras/);
    expect(startError({ contrast: true }, true, true)).toBeNull();
  });

  it('dosis CT wajib (CTDIvol, DLP) sebelum ekspertise; modalitas lain tidak', () => {
    expect(doseError('CT', null, null)).toMatch(/CTDIvol/);
    expect(doseError('CT', 12.5, null)).toMatch(/DLP/);
    expect(doseError('CT', 250, 400)).toMatch(/CTDIvol/);
    expect(doseError('CT', 12.5, 640)).toBeNull();
    expect(doseError('DR', null, null)).toBeNull();
    expect(parseDecimal('12,5')).toBe(12.5);
    expect(parseDecimal('12.5')).toBe(12.5);
    expect(parseDecimal('abc')).toBeNull();
  });

  it('TTE radiolog hanya bila temuan dan kesan lengkap (templat tanpa isian kosong)', () => {
    expect(reportError('', '')).toMatch(/Temuan/);
    expect(reportError('Cor dan pulmo dalam batas normal tanpa kelainan.', 'pendek')).toMatch(/Kesan/);
    const angio = templateFor(byId('rad-sutan'));
    expect(angio.id).toBe('angiografi');
    expect(reportError(angio.findings, angio.impression)).toMatch(/__/);
    const t = templateFor(byId('rad-endang'));
    expect(t.id).toBe('toraks');
    expect(reportError(t.findings, t.impression)).toBeNull();
    expect(templateFor(byId('rad-dewi')).id).toBe('usg-abdomen');
  });

  it('langkah lokal berurutan: mulai → akuisisi (dosis) → TTE; worklist cito dulu', () => {
    const e = byId('rad-rizky');
    const now = '2026-10-05T11:02:00+07:00';
    expect(applyRadLocal(e, { finishedAt: now }).status).toBe('terjadwal');
    const done = applyRadLocal(e, {
      startedAt: now,
      finishedAt: now,
      report: { findings: 'x'.repeat(30), impression: 'y'.repeat(12), radiologist: RADIOLOG, signedAt: now },
    });
    expect(done.status).toBe('ditandatangani');
    const ct = applyRadLocal(byId('rad-maria'), { finishedAt: now, dose: { ctdiVol: 14, dlp: 720 } });
    expect(ct).toMatchObject({ status: 'ekspertise', dose: { ctdiVol: 14, dlp: 720 } });
    expect(sortExams(demoRadiologyExams())[0]?.id).toBe('rad-hendro');
  });
});

describe('Tn. Hartono: foto toraks dari order set IGD', () => {
  it('tidak ada sebelum order set atau bila order manual', () => {
    expect(hartonoChestXray(runScenario(IGD, at(IGD, 'asesmen-dokter')))).toBeNull();
    const manual = act(IGD, act(IGD, at(IGD, 'asesmen-dokter'), 'ekg'), 'orderset', 'manual');
    expect(hartonoChestXray(runScenario(IGD, manual))).toBeNull();
  });

  it('terjadwal cito → menunggu ekspertise saat tata laksana → ditandatangani saat admisi', () => {
    const s1 = hartonoChestXray(runScenario(IGD, at(IGD, 'nilai-kritis')));
    expect(s1).toMatchObject({
      procedure: 'Foto toraks',
      priority: 'cito',
      status: 'terjadwal',
      procedureCode: null,
    });
    expect(hartonoChestXray(runScenario(IGD, at(IGD, 'tata-laksana')))?.status).toBe('ekspertise');
    const signed = hartonoChestXray(runScenario(IGD, at(IGD, 'admisi')));
    expect(signed?.status).toBe('ditandatangani');
    expect(signed?.report?.impression).toContain('Kardiomegali');
    const results = {
      'rawat-jalan': runScenario(SCENARIOS['rawat-jalan'], []),
      'igd-ranap': runScenario(IGD, at(IGD, 'admisi')),
      'elektif-btn': runScenario(SCENARIOS['elektif-btn'], []),
    };
    expect(
      radiologyWorklistSchema.parse(demoRadiologyWorklist(scenarioRadiologyExams(results))).exams,
    ).toHaveLength(10);
  });
});

describe('gerbang Server Action radiologi (order dicari server, bukan dari klien)', () => {
  it('id pemeriksaan yang tidak ada di worklist ditolak di setiap langkah', () => {
    const unknown = { message: RAD_EXAM_UNKNOWN };
    expect(radStartGate(undefined, true, true)).toEqual(unknown);
    expect(radFinishGate(undefined, 14.2, 720)).toEqual(unknown);
    expect(radSignGate(undefined, 'Temuan lengkap tanpa kelainan bermakna.', 'Dalam batas normal.')).toEqual(
      unknown,
    );
  });

  it('skrining kontras dibaca dari order: angiografi berkontras tetap wajib skrining', () => {
    const sutan = byId('rad-sutan');
    expect(sutan.contrast).toBe(true);
    expect(radStartGate(sutan, true, false)?.message).toMatch(/Skrining kontras/);
    expect(radStartGate(sutan, true, true)).toBeNull();
    expect(radStartGate(byId('rad-rizky'), false, false)?.message).toMatch(/identitas/);
    expect(radStartGate(byId('rad-rizky'), true, false)).toBeNull();
  });

  it('dosis dibaca dari modalitas order: CT wajib dosis, DR tidak', () => {
    const maria = byId('rad-maria');
    expect(maria.modality).toBe('CT');
    expect(radFinishGate(maria, null, null)).toEqual({
      message: expect.stringMatching(/CTDIvol/),
      field: 'dose',
    });
    expect(radFinishGate(maria, 14.2, 720)).toBeNull();
    expect(radFinishGate(byId('rad-hendro'), null, null)).toBeNull();
  });

  it('TTE radiolog: ekspertise lengkap', () => {
    const dewi = byId('rad-dewi');
    expect(radSignGate(dewi, 'pendek', 'pendek')).toEqual({
      message: 'Temuan wajib diisi (minimal 20 karakter).',
      field: 'report',
    });
    expect(
      radSignGate(dewi, 'Hepar dan kandung empedu dalam batas normal.', 'USG abdomen normal.'),
    ).toBeNull();
  });
});
