import { edBoardSchema, triageAssessmentSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { applyAction, runScenario } from './demo/engine/run';
import type { ScenarioEvent, TaskValue } from './demo/engine/types';
import { demoEdBoardBase } from './demo/fixtures/rawat-inap';
import { DEMO_NOW } from './demo/fixtures/waktu';
import { SCENARIOS } from './demo/skenario';
import {
  edKpis,
  filterEdItems,
  formatLos,
  formatTimer,
  losOverdue,
  newWalkIn,
  triageNeedsReason,
  triageSaveAllowed,
} from './rawat-inap';
import { hartonoEdItem, stepState } from './rawat-inap-scenario';

/** Jalankan tugas berurutan di langkah aktif skenario (gagal keras bila mesin menolak). */
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

describe('K03 · IGD', () => {
  it('papan IGD lolos kontrak ketat, dengan dan tanpa pasien skenario', () => {
    const board = demoEdBoardBase(DEMO_NOW);
    expect(() => edBoardSchema.parse(board)).not.toThrow();
    const hartono = hartonoEdItem(runScenario(SCENARIOS['igd-ranap'], []), DEMO_NOW);
    expect(() => edBoardSchema.parse({ ...board, items: [...board.items, hartono] })).not.toThrow();
    expect(board.items.length + 1).toBeGreaterThanOrEqual(9);
    expect(new Set(board.items.map((p) => p.encounterId)).size).toBe(board.items.length);
  });

  it('turun dari saran sistem wajib alasan ≥ 10 karakter; naik atau sama tidak', () => {
    const base = { encounterId: 'kj-x', suggestedLevel: 2 as const, orders: [] };
    expect(triageAssessmentSchema.safeParse({ ...base, chosenLevel: 3, overrideReason: null }).success).toBe(
      false,
    );
    expect(
      triageAssessmentSchema.safeParse({ ...base, chosenLevel: 3, overrideReason: 'singkat' }).success,
    ).toBe(false);
    expect(
      triageAssessmentSchema.safeParse({
        ...base,
        chosenLevel: 3,
        overrideReason: 'EKG awal normal, nyeri atipikal',
      }).success,
    ).toBe(true);
    expect(triageAssessmentSchema.safeParse({ ...base, chosenLevel: 1, overrideReason: null }).success).toBe(
      true,
    );
    expect(triageNeedsReason(2, 3)).toBe(true);
    expect(triageNeedsReason(2, 2)).toBe(false);
    expect(triageSaveAllowed(2, 4, '   ')).toBe(false);
    expect(triageSaveAllowed(2, 4, 'Nyeri atipikal, EKG normal')).toBe(true);
  });

  it('KPI, filter zona/level, dan format lama tinggal', () => {
    const items = demoEdBoardBase(DEMO_NOW).items;
    const k = edKpis(items);
    expect(k.total).toBe(items.length);
    expect(k.high).toBe(items.filter((p) => (p.triageLevel ?? 9) <= 2).length);
    expect(k.boarding).toBe(1);
    expect(filterEdItems(items, 'K', 0).every((p) => p.zone === 'K')).toBe(true);
    expect(filterEdItems(items, 'semua', 3).every((p) => p.triageLevel === 3)).toBe(true);
    expect(formatLos(280)).toBe('04.40 j');
    expect(formatTimer(3725)).toBe('01:02:05');
    expect(losOverdue({ triageLevel: 3, status: 'tunggu-bed' }, 241)).toBe(true);
    expect(losOverdue({ triageLevel: 2, status: 'tunggu-dokter' }, 11)).toBe(true);
    expect(
      edBoardSchema.shape.items.element.safeParse(newWalkIn('baru', 2, '2026-10-05T10:50:00+07:00')).success,
    ).toBe(true);
  });

  it('Tn. Hartono tampil sejak skenario dimulai; triase 3 menahan penempatan sampai alasan ditulis', () => {
    const def = SCENARIOS['igd-ranap'];
    const start = hartonoEdItem(runScenario(def, []), DEMO_NOW);
    expect(start).toMatchObject({ status: 'registrasi', triageLevel: null, bed: null, zone: 'T' });

    const seq = play('igd-ranap', [
      ['id', 'ktp'],
      ['gelang', true],
      'next',
      ['ttv', '158/94 · 112 · 24 · 94%'],
      ['level', '3'],
    ]);
    const R = runScenario(def, seq);
    const tr = stepState(R, 'triase', 7);
    expect(tr.tasks.alasan).toMatchObject({ visible: true, enabled: true });
    expect(tr.tasks.bed?.enabled).toBe(false);
    expect(applyAction(def, seq, { type: 'task', step: R.step, task: 'bed', value: true }).ok).toBe(false);
    expect(hartonoEdItem(R, DEMO_NOW)).toMatchObject({ triageLevel: 3, status: 'triase' });

    const placed = play(
      'igd-ranap',
      [
        ['alasan', 'EKG awal tanpa elevasi ST'],
        ['bed', true],
      ],
      seq,
    );
    const item = hartonoEdItem(runScenario(def, placed), DEMO_NOW);
    expect(item).toMatchObject({ bed: 'R2', zone: 'R', status: 'pemeriksaan' });
    expect(item?.vitals[0]).toMatchObject({ label: 'TD', value: '158/94', abnormal: true });
  });
});
