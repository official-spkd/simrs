import type { EdStatus, EdTrackingItem, TriageLevel } from '@simrs/shared';
import { firstOpenTask, taskKey, taskOptions, visibleTasks } from './demo/engine/run';
import type { RunResult, ScenarioId, TaskValue } from './demo/engine/types';
import { encounterIdOf, patientByScenario } from './demo/fixtures/pasien';
import { minutesBefore } from './demo/fixtures/rawat-inap';
import { STAF } from './demo/fixtures/staf';
import { isTriageLevel } from './rawat-inap';

/**
 * Proyeksi pasien skenario Simulasi (Tn. Hartono · igd-ranap, Ny. Ratna · elektif-btn) ke layar IGD, tempat
 * tidur, rawat inap, resume, dan persetujuan tindakan (ADR-0023). Murni: hanya membaca `RunResult` hasil replay,
 * sehingga layar mana pun dan tab mana pun menampilkan keadaan yang sama.
 */

export function stepIndexOf(R: RunResult, stepId: string): number {
  const i = R.def.steps.findIndex((s) => s.id === stepId);
  if (i < 0) throw new Error(`Langkah ${stepId} tidak ada di skenario ${R.def.id}`);
  return i;
}

/** Tugas `stepId.taskId` sudah selesai? */
export function isDone(R: RunResult, stepId: string, taskId: string): boolean {
  return R.done.has(taskKey(stepIndexOf(R, stepId), taskId));
}

export function valueOf(R: RunResult, stepId: string, taskId: string): TaskValue | undefined {
  return R.done.get(taskKey(stepIndexOf(R, stepId), taskId));
}

/** Langkah sudah dimulai (aktif atau lewat)? */
export function reached(R: RunResult, stepId: string): boolean {
  return R.finished || R.step >= stepIndexOf(R, stepId);
}

export interface ScenarioTaskState {
  /** Tugas terbuka pertama di langkah aktif: tombol asli layar boleh menjalankannya. */
  enabled: boolean;
  done: boolean;
  /** Syarat `when` terpenuhi (mis. alasan triase hanya bila level 3). */
  visible: boolean;
  /** Nilai selesai: id pilihan, isi isian, atau "true" untuk aksi. */
  value: string | null;
  options: Array<{ id: string; label: string; sub: string }>;
}

/** Keadaan satu langkah skenario untuk komponen klien (bisa diserialisasi). */
export interface ScenarioStepState {
  scenario: ScenarioId;
  stepId: string;
  step: number;
  active: boolean;
  rev: number;
  tasks: Record<string, ScenarioTaskState>;
}

export function stepState(R: RunResult, stepId: string, rev: number): ScenarioStepState {
  const i = stepIndexOf(R, stepId);
  const active = !R.finished && R.step === i;
  const open = active ? firstOpenTask(R, i) : null;
  const visible = new Set(visibleTasks(R, i).map((t) => t.id));
  const tasks: Record<string, ScenarioTaskState> = {};
  for (const t of R.def.steps[i]?.tasks ?? []) {
    const v = R.done.get(taskKey(i, t.id));
    tasks[t.id] = {
      enabled: open?.id === t.id,
      done: v !== undefined,
      visible: visible.has(t.id),
      value: v === undefined ? null : v === true ? 'true' : v,
      options:
        t.kind === 'choice'
          ? taskOptions(t, R.rec).map((o) => ({ id: o.id, label: o.label, sub: o.sub ?? '' }))
          : [],
    };
  }
  return { scenario: R.def.id, stepId, step: i, active, rev, tasks };
}

// ---------------------------------------------------------------------------------------------------------
// IGD · Tn. Hartono
// ---------------------------------------------------------------------------------------------------------

const HARTONO_DEFAULT_VITALS = ['—', '—', '—', '—'] as const;

/** "158/94 · 112 · 24 · 94%" → [TD, nadi, RR, SpO2]. */
export function parseTtv(ttv: string): [string, string, string, string] {
  const parts = ttv.split('·').map((s) => s.trim());
  if (parts.length < 4) return [...HARTONO_DEFAULT_VITALS];
  return [parts[0] ?? '—', parts[1] ?? '—', parts[2] ?? '—', parts[3] ?? '—'];
}

function vitalsFrom(ttv: string): EdTrackingItem['vitals'] {
  const [td, hr, rr, spo2] = parseTtv(ttv);
  const sys = Number(td.split('/')[0]);
  return [
    { label: 'TD', value: td, abnormal: sys >= 140 },
    { label: 'Nadi', value: hr, abnormal: Number(hr) > 100 },
    { label: 'Napas', value: rr, abnormal: Number(rr) > 20 },
    { label: 'SpO2', value: spo2, abnormal: Number.parseInt(spo2, 10) < 95 },
    { label: 'Suhu', value: ttv ? '36,9' : '—', abnormal: false },
    { label: 'GCS', value: ttv ? '15' : '—', abnormal: false },
  ];
}

/** Tn. Hartono di papan IGD sejak skenario dimulai sampai serah terima ke ruang rawat. */
export function hartonoEdItem(R: RunResult, asOf: string): EdTrackingItem | null {
  if (isDone(R, 'admisi', 'transfer')) return null;
  const p = patientByScenario('igd-ranap');
  if (!p) return null;
  const placed = isDone(R, 'triase', 'bed');
  let status: EdStatus = 'pemeriksaan';
  if (!isDone(R, 'kedatangan', 'gelang')) status = 'registrasi';
  else if (!placed) status = 'triase';
  else if (isDone(R, 'tata-laksana', 'dispo')) status = 'tunggu-bed';
  else if (isDone(R, 'nilai-kritis', 'hasil')) status = 'pemeriksaan';
  else if (isDone(R, 'asesmen-dokter', 'orderset')) status = 'tunggu-lab';
  const lv = Number(valueOf(R, 'triase', 'level'));
  const level: TriageLevel | null = isTriageLevel(lv) ? lv : null;
  const los = Math.max(0, R.clock - R.def.startMin);
  return {
    encounterId: encounterIdOf(p.id),
    bed: placed ? 'R2' : null,
    zone: placed ? 'R' : 'T',
    patientId: p.id,
    patientName: p.nama,
    rm: p.rm,
    sex: p.jk,
    ageLabel: `${p.umur} th`,
    guarantor: isDone(R, 'admisi', 'bpjs') ? 'BPJS Kelas 1 · aktif' : 'BPJS · cek menyusul',
    triageLevel: level,
    suggestedLevel: 2,
    maxLevel: 3,
    chiefComplaint: 'Nyeri dada kiri menjalar ke lengan, 40 menit',
    doctor: !placed ? null : isDone(R, 'tata-laksana', 'dispo') ? STAF.dpjpJantung : STAF.dokterJagaIgd,
    arrivedAt: minutesBefore(asOf, los),
    losMinutes: los,
    status,
    arrivalMode: 'diantar keluarga',
    vitals: vitalsFrom(R.rec.ttv),
    recommendation:
      'Nyeri dada tipikal + takikardia + SpO2 94%: triase 2, EKG ≤ 10 menit, aktifkan alur sindrom koroner akut.',
    orderTitle: 'Order awal otomatis (alur SKA)',
    orders: [
      { id: 'ekg', label: 'EKG 12 sadapan', defaultOn: true },
      { id: 'lab-ska', label: 'Troponin I, darah lengkap, elektrolit', defaultOn: true },
      { id: 'konsul-jantung', label: 'Konsul kardiologi jaga', defaultOn: false },
    ],
    scenario: true,
  };
}
