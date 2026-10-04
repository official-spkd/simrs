import type {
  ApplyContext,
  ChargeLine,
  ChoiceTask,
  LogEntry,
  RunResult,
  ScenarioAction,
  ScenarioDef,
  ScenarioEvent,
  ScenarioRecord,
  ScenarioTask,
  TaskOption,
  TaskValue,
} from './types';

/** Isian bebas dibatasi agar keadaan tersimpan tetap kecil dan tidak bisa dipakai menimbun data. */
export const MAX_INPUT_LENGTH = 120;

export const taskKey = (step: number, task: string) => `${step}.${task}`;

export function taskOptions(task: ChoiceTask, rec: ScenarioRecord): readonly TaskOption[] {
  return typeof task.options === 'function' ? task.options(rec) : task.options;
}

/**
 * Putar ulang urutan kejadian dari rekam medis awal (port `run()` mockup Simulasi). Murni: tidak membaca jam,
 * acak, atau I/O, sehingga keadaan yang sama selalu menghasilkan tampilan yang sama.
 */
export function runScenario(def: ScenarioDef, seq: readonly ScenarioEvent[]): RunResult {
  const rec = structuredClone(def.base);
  const logs: LogEntry[] = [];
  const charges: ChargeLine[] = [];
  let clock = def.startMin;
  const per = def.steps.map(() => ({ wait: 0, svc: 0 }));
  const stepStart: Array<number | null> = def.steps.map(() => null);
  stepStart[0] = clock;
  const done = new Map<string, TaskValue>();
  const doneAt = new Map<string, number>();
  let step = 0;
  let finished = false;
  let actor = '';
  let stage = '';
  const ctx: ApplyContext = {
    now: clock,
    opt: '',
    optSub: '',
    log: (text, sys) => logs.push({ t: clock, actor, text, sys: sys ?? '' }),
    charge: (name, amount) => charges.push({ name, amount, src: stage }),
  };

  for (const e of seq) {
    if ('adv' in e) {
      if (e.adv >= def.steps.length) {
        finished = true;
        continue;
      }
      const w = def.steps[e.adv]?.wait ?? 0;
      clock += w;
      const p = per[e.adv];
      if (p) p.wait += w;
      stepStart[e.adv] = clock;
      step = e.adv;
      continue;
    }
    const st = def.steps[e.s];
    const tk = st?.tasks.find((t) => t.id === e.t);
    if (!st || !tk) continue;
    const du = typeof tk.dur === 'function' ? tk.dur(e.v) : tk.dur;
    clock += du;
    const p = per[e.s];
    if (p) p.svc += du;
    ctx.now = clock;
    actor = st.actor;
    stage = st.stage;
    ctx.opt = '';
    ctx.optSub = '';
    if (tk.kind === 'choice') {
      const o = taskOptions(tk, rec).find((x) => x.id === e.v);
      ctx.opt = o ? o.label : String(e.v);
      ctx.optSub = o?.sub ?? '';
    }
    done.set(taskKey(e.s, e.t), e.v);
    doneAt.set(taskKey(e.s, e.t), clock);
    tk.apply?.(rec, e.v, ctx);
  }
  return { def, rec, logs, charges, clock, per, stepStart, done, doneAt, step, finished };
}

/** Tugas yang tampil di langkah `si` (syarat `when` dievaluasi terhadap rekam medis terkini). */
export function visibleTasks(R: RunResult, si: number): ScenarioTask[] {
  const st = R.def.steps[si];
  if (!st) return [];
  const lookup = (id: string) => R.done.get(taskKey(si, id));
  return st.tasks.filter((t) => !t.when || t.when(R.rec, lookup));
}

export function stepComplete(R: RunResult, si: number): boolean {
  return visibleTasks(R, si).every((t) => R.done.has(taskKey(si, t.id)));
}

/** Hanya tugas terbuka pertama yang boleh dikerjakan (urutan kerja seperti di lapangan). */
export function firstOpenTask(R: RunResult, si: number): ScenarioTask | null {
  return visibleTasks(R, si).find((t) => !R.done.has(taskKey(si, t.id))) ?? null;
}

/** Nilai bawaan saat putar otomatis; null bila isian bawaan tidak sah (putar otomatis berhenti). */
export function defaultValue(task: ScenarioTask, rec: ScenarioRecord): TaskValue | null {
  if (task.kind === 'act') return true;
  if (task.kind === 'input') return task.check(task.def) ? null : task.def;
  return task.def ?? taskOptions(task, rec)[0]?.id ?? null;
}

export type ActionOutcome =
  | { ok: true; seq: ScenarioEvent[] }
  | { ok: false; error: string; /** Tugas yang galat (untuk menandai isian). */ task?: string };

const fail = (error: string, task?: string): ActionOutcome => ({ ok: false, error, task });

/**
 * Terapkan satu aksi presenter dengan aturan gerbang mockup: hanya tugas terbuka pertama di langkah aktif,
 * nilai harus sah untuk jenis tugasnya (isian lolos `check`, pilihan ada di daftar), dan pindah langkah hanya
 * bila semua tugas yang tampil sudah selesai.
 */
export function applyAction(
  def: ScenarioDef,
  seq: readonly ScenarioEvent[],
  action: ScenarioAction,
): ActionOutcome {
  const R = runScenario(def, seq);
  if (R.finished) return fail('Simulasi sudah selesai. Mulai ulang untuk mengulang.');
  if (action.type === 'next') {
    if (!stepComplete(R, R.step)) return fail('Selesaikan semua tugas di langkah ini lebih dulu.');
    return { ok: true, seq: [...seq, { adv: R.step + 1 }] };
  }
  const open = firstOpenTask(R, R.step);
  if (action.type === 'auto') {
    if (!open) return applyAction(def, seq, { type: 'next' });
    const value = defaultValue(open, R.rec);
    if (value === null) return fail('Isian bawaan tidak sah; lengkapi secara manual.', open.id);
    return applyAction(def, seq, { type: 'task', step: R.step, task: open.id, value });
  }
  if (action.step !== R.step) return fail('Langkah ini bukan langkah aktif.');
  if (!open || open.id !== action.task) return fail('Tugas ini belum gilirannya.', action.task);
  let value: TaskValue;
  if (open.kind === 'act') {
    if (action.value !== true) return fail('Aksi tidak dikenal.', open.id);
    value = true;
  } else if (open.kind === 'choice') {
    const id = action.value;
    if (typeof id !== 'string' || !taskOptions(open, R.rec).some((o) => o.id === id)) {
      return fail('Pilihan tidak dikenal.', open.id);
    }
    value = id;
  } else {
    if (typeof action.value !== 'string') return fail('Isian tidak dikenal.', open.id);
    const text = action.value.trim();
    if (text.length > MAX_INPUT_LENGTH) return fail(`Maksimal ${MAX_INPUT_LENGTH} karakter.`, open.id);
    const problem = open.check(text);
    if (problem) return fail(problem, open.id);
    value = text;
  }
  return { ok: true, seq: [...seq, { s: R.step, t: open.id, v: value }] };
}

const sameEvent = (a: ScenarioEvent, b: ScenarioEvent) =>
  'adv' in a ? 'adv' in b && a.adv === b.adv : !('adv' in b) && a.s === b.s && a.t === b.t && a.v === b.v;

/**
 * Bagian awal urutan yang sah menurut aturan gerbang (keadaan tersimpan yang rusak, basi, atau diubah tangan
 * dipotong di kejadian pertama yang tidak sah).
 */
export function sanitizeSeq(def: ScenarioDef, seq: readonly ScenarioEvent[]): ScenarioEvent[] {
  let valid: ScenarioEvent[] = [];
  for (const e of seq) {
    const action: ScenarioAction =
      'adv' in e ? { type: 'next' } : { type: 'task', step: e.s, task: e.t, value: e.v };
    const r = applyAction(def, valid, action);
    const last = r.ok ? r.seq.at(-1) : undefined;
    if (!r.ok || !last || !sameEvent(last, e)) break;
    valid = r.seq;
  }
  return valid;
}

/** Putar otomatis sampai langkah `target` aktif ("Lompat ke tahap"), memakai nilai bawaan tiap tugas. */
export function advanceTo(def: ScenarioDef, seq: readonly ScenarioEvent[], target: number): ActionOutcome {
  let cur = [...seq];
  for (let guard = 0; guard < 500; guard++) {
    const R = runScenario(def, cur);
    if (R.finished || R.step >= target) return { ok: true, seq: cur };
    const r = applyAction(def, cur, { type: 'auto' });
    if (!r.ok) return r;
    cur = r.seq;
  }
  return fail('Lompatan tidak selesai.');
}
