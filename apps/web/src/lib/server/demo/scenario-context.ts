import 'server-only';
import { runScenario, taskKey } from '../../demo/engine/run';
import type { RunResult, ScenarioId, TaskValue } from '../../demo/engine/types';
import { SCENARIO_ORDER, SCENARIOS } from '../../demo/skenario';
import { type SimStepView, simulationView } from '../../demo/simulasi-view';
import type { SessionView } from '../../session-view';
import { loadDemoRuns } from './scenario';

/**
 * Keadaan skenario untuk layar-layar asli di mode presentasi (ADR-0023). Layar memakai ini untuk dua hal:
 * 1. memproyeksikan pasien skenario ke daftarnya sesuai kemajuan (`milestone()` — mis. Tn. Suryo muncul di
 *    antrean pendaftaran setelah tiket admisi dicetak, berstatus "SEP terbit" setelah `pendaftaran.sep`);
 * 2. menampilkan banner tugas langkah yang sedang dibawakan di layar itu (`scenariosHere()` + `ScenarioBanner`).
 * Semua dihitung dari replay murni, jadi konsisten di layar mana pun dan di tab/perangkat lain.
 */

export interface ScenarioRuns {
  /** Revisi keadaan (kirim bersama setiap perintah ke server). */
  rev: number;
  active: ScenarioId;
  results: Record<ScenarioId, RunResult>;
}

export async function scenarioRuns(session: SessionView): Promise<ScenarioRuns> {
  const runs = await loadDemoRuns(session);
  const results = Object.fromEntries(
    SCENARIO_ORDER.map((id) => [id, runScenario(SCENARIOS[id], runs.runs[id])]),
  ) as Record<ScenarioId, RunResult>;
  return { rev: runs.rev, active: runs.active, results };
}

function stepIndex(R: RunResult, stepId: string): number {
  const i = R.def.steps.findIndex((s) => s.id === stepId);
  if (i < 0) throw new Error(`Langkah ${stepId} tidak ada di skenario ${R.def.id}`);
  return i;
}

/** Sudah selesaikah tugas `taskId` di langkah `stepId`? (Langkah/tugas yang salah ketik → galat, bukan false.) */
export function milestone(R: RunResult, stepId: string, taskId: string): boolean {
  const i = stepIndex(R, stepId);
  if (!R.def.steps[i]?.tasks.some((t) => t.id === taskId)) {
    throw new Error(`Tugas ${stepId}.${taskId} tidak ada di skenario ${R.def.id}`);
  }
  return R.done.has(taskKey(i, taskId));
}

/** Nilai tugas yang sudah selesai (id pilihan atau isi isian), atau undefined. */
export function milestoneValue(R: RunResult, stepId: string, taskId: string): TaskValue | undefined {
  return R.done.get(taskKey(stepIndex(R, stepId), taskId));
}

/** Id langkah aktif (null bila skenario selesai). */
export function activeStepId(R: RunResult): string | null {
  return R.finished ? null : (R.def.steps[R.step]?.id ?? null);
}

/** Langkah `stepId` sudah dimulai (aktif atau sudah lewat)? */
export function stepReached(R: RunResult, stepId: string): boolean {
  return R.finished || R.step >= stepIndex(R, stepId);
}

export interface ScenarioHere {
  scenario: ScenarioId;
  label: string;
  patientName: string;
  rm: string;
  step: SimStepView;
}

/** Skenario yang langkah aktifnya dibawakan di layar `screenId` (dasar banner tugas di layar itu). */
export function scenariosHere(runs: ScenarioRuns, screenId: string): ScenarioHere[] {
  return SCENARIO_ORDER.flatMap((id) => {
    const R = runs.results[id];
    if (R.finished || R.def.steps[R.step]?.screen !== screenId) return [];
    const step = simulationView(R, null).step;
    return step ? [{ scenario: id, label: R.def.label, patientName: R.rec.nama, rm: R.rec.rm, step }] : [];
  });
}
