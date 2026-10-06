import { formatRupiah, SYSTEM_ROLES, type SystemRoleCode } from '@simrs/shared';
import { screenById } from '../screens';
import { formatSimClock, formatSimDate, formatSimDuration, type LogKind, logKind } from './engine/format';
import { firstOpenTask, stepComplete, taskKey, taskOptions, visibleTasks } from './engine/run';
import {
  billSummary,
  bpjsQueueTasks,
  integrationCounts,
  recordRows,
  scenarioSummary,
} from './engine/summary';
import type { RunResult, ScenarioDef } from './engine/types';

/**
 * Model tampilan layar Simulasi (mockup `Simulasi.dc.html`), dihitung di server dari hasil replay. Semuanya bisa
 * diserialkan (tanpa fungsi/bigint) agar aman dikirim ke komponen klien.
 */

export interface SimTaskView {
  id: string;
  kind: 'act' | 'choice' | 'input';
  label: string;
  hint: string;
  tone: 'danger' | 'warn' | null;
  status: 'selesai' | 'giliran' | 'menunggu';
  /** "Selesai · 07.13", "Giliran sekarang", "Menunggu". */
  statusText: string;
  enabled: boolean;
  btn: string;
  options: Array<{ id: string; label: string; sub: string; selected: boolean }>;
  inputDefault: string;
  placeholder: string;
  /** Hasil yang ditampilkan setelah selesai (aksi/isian). */
  doneText: string;
}

export interface SimStepView {
  index: number;
  no: string;
  stage: string;
  actor: string;
  role: SystemRoleCode | null;
  roleName: string | null;
  title: string;
  desc: string;
  screen: { id: string; label: string; route: string; ready: boolean } | null;
  /** Langkah yang sudah lewat (hanya ditinjau). */
  past: boolean;
  tasks: SimTaskView[];
  footNote: string;
  nextLabel: string;
  canNext: boolean;
}

export interface SimJourneyTile {
  index: number;
  stage: string;
  actor: string;
  mark: string;
  time: string;
  state: 'selesai' | 'aktif' | 'belum';
  viewing: boolean;
  clickable: boolean;
}

export interface SimSummaryView {
  title: string;
  sub: string;
  stats: Array<{ label: string; value: string; note: string }>;
  bars: Array<{ stage: string; waitPct: number; servicePct: number; text: string }>;
  auto: string[];
}

export interface SimulationView {
  scenario: { id: string; label: string };
  patient: {
    initials: string;
    nama: string;
    meta: string;
    alergi: string;
    riwayat: string;
    penjamin: string;
    lokasi: string;
  };
  clock: { text: string; sub: string };
  journey: SimJourneyTile[];
  progress: number;
  step: SimStepView | null;
  summary: SimSummaryView | null;
  record: Array<{ label: string; value: string }>;
  integration: Array<{ kind: Exclude<LogKind, 'internal'>; label: string; value: number }>;
  bpjsTasks: Array<{ n: number; name: string; time: string | null }> | null;
  charges: Array<{ name: string; src: string; amount: string }>;
  bill: { total: string; covered: string; patient: string };
  logs: Array<{ key: string; time: string; actor: string; text: string; sys: string; kind: LogKind }>;
  finished: boolean;
  activeStep: number;
  stepsCount: number;
}

/** Nama skenario untuk teks (bukan tab), mis. "Bedah elektif · BTN". */
export const scenarioName = (def: Pick<ScenarioDef, 'label' | 'name'>) => def.name ?? def.label;

const roleName = (r: SystemRoleCode | null) => (r ? SYSTEM_ROLES[r] : null);

/** `view` = indeks langkah yang ditinjau, atau `null` untuk langkah aktif (ringkasan bila sudah selesai). */
export function simulationView(R: RunResult, view: number | null): SimulationView {
  const def = R.def;
  const N = def.steps.length;
  const fmt = (m: number) => formatSimClock(def, m);
  const showSummary = R.finished && (view === null || view >= N);
  const vi = showSummary ? null : Math.min(view ?? R.step, R.finished ? N - 1 : R.step);

  const journey: SimJourneyTile[] = def.steps.map((s, i) => {
    const done = R.finished || i < R.step;
    const cur = !R.finished && i === R.step;
    const start = R.stepStart[i];
    return {
      index: i,
      stage: s.stage,
      actor: s.actor,
      mark: done ? '✓' : String(i + 1),
      time: (done || cur) && start != null ? fmt(start) : 'Belum',
      state: done ? 'selesai' : cur ? 'aktif' : 'belum',
      viewing: vi === i,
      clickable: R.finished || i <= R.step,
    };
  });
  journey.push({
    index: N,
    stage: 'Selesai',
    actor: 'Ringkasan simulasi',
    mark: R.finished ? '✓' : String(N + 1),
    time: R.finished ? fmt(R.clock) : 'Belum',
    state: R.finished ? 'selesai' : 'belum',
    viewing: showSummary,
    clickable: R.finished,
  });

  const curVis = visibleTasks(R, Math.min(R.step, N - 1));
  const curDone = curVis.filter((t) => R.done.has(taskKey(R.step, t.id))).length;
  const progress = R.finished
    ? 100
    : Math.round(((R.step + (curVis.length ? curDone / curVis.length : 0)) / N) * 100);

  let step: SimStepView | null = null;
  if (vi !== null) {
    const s = def.steps[vi];
    if (s) {
      const past = R.finished || vi < R.step;
      const open = past ? null : firstOpenTask(R, vi);
      const vt = visibleTasks(R, vi);
      const tasks: SimTaskView[] = vt.map((tk) => {
        const key = taskKey(vi, tk.id);
        const v = R.done.get(key);
        const done = v !== undefined;
        const enabled = !past && !!open && open.id === tk.id;
        const at = R.doneAt.get(key);
        let doneText = '';
        if (done && tk.kind === 'input') doneText = String(v);
        if (done && tk.kind === 'act') {
          doneText = typeof tk.result === 'function' ? tk.result(R.rec) : (tk.result ?? 'Selesai');
        }
        return {
          id: tk.id,
          kind: tk.kind,
          label: tk.label,
          hint: tk.hint ?? '',
          tone: tk.tone ?? null,
          status: done ? 'selesai' : enabled ? 'giliran' : 'menunggu',
          statusText: done
            ? `Selesai · ${at != null ? fmt(at) : ''}`
            : enabled
              ? 'Giliran sekarang'
              : 'Menunggu',
          enabled,
          btn: tk.kind === 'act' ? tk.btn : 'Simpan',
          options:
            tk.kind === 'choice'
              ? taskOptions(tk, R.rec).map((o) => ({
                  id: o.id,
                  label: o.label,
                  sub: o.sub ?? '',
                  selected: done && v === o.id,
                }))
              : [],
          inputDefault: tk.kind === 'input' ? tk.def : '',
          placeholder: tk.kind === 'input' ? tk.ph : '',
          doneText,
        };
      });
      const complete = stepComplete(R, vi);
      const isLast = vi === N - 1;
      const doneCount = vt.filter((t) => R.done.has(taskKey(vi, t.id))).length;
      const next = def.steps[vi + 1];
      const screen = screenById(s.screen);
      step = {
        index: vi,
        no: `${vi + 1} dari ${N}`,
        stage: s.stage,
        actor: s.actor,
        role: s.role,
        roleName: roleName(s.role),
        title: s.title,
        desc: s.desc,
        screen: screen
          ? { id: screen.id, label: screen.label, route: screen.route, ready: screen.status !== 'belum' }
          : null,
        past,
        tasks,
        footNote: past
          ? `Langkah dimulai ${R.stepStart[vi] != null ? fmt(R.stepStart[vi] ?? 0) : '—'}, durasi kerja ${formatSimDuration(R.per[vi]?.svc ?? 0)}.`
          : complete
            ? isLast
              ? 'Semua tugas selesai. Simulasi siap ditutup.'
              : `Semua tugas selesai. Jeda sebelum tahap berikutnya: ${formatSimDuration(next?.wait ?? 0)}.`
            : `${doneCount} dari ${vt.length} tugas selesai. Tahap berikutnya terbuka setelah semua tugas selesai.`,
        nextLabel: isLast ? 'Selesaikan simulasi' : `Lanjut: ${next?.stage ?? ''}`,
        canNext: !past && complete,
      };
    }
  }

  const sum = scenarioSummary(R);
  const bill = billSummary(R);
  const rp = (n: bigint) => formatRupiah(n);
  let summary: SimSummaryView | null = null;
  if (showSummary) {
    const maxT = Math.max(1, ...sum.bars.map((b) => b.wait + b.service));
    const start = def.showDay ? fmt(def.startMin) : `${formatSimDate(def)} ${fmt(def.startMin)}`;
    summary = {
      title: `${scenarioName(def)}: ${R.rec.nama}`,
      sub: `Datang ${start}, pulang ${R.rec.pulangAt != null ? fmt(R.rec.pulangAt) : '—'}. Semua data di bawah dihasilkan dari keputusan Anda di tiap langkah.`,
      stats: [
        {
          label: 'Lama di rumah sakit',
          value: formatSimDuration(sum.lengthOfStay),
          note: 'dari kedatangan sampai pulang',
        },
        {
          label: 'Total jeda/menunggu',
          value: formatSimDuration(sum.waitMinutes),
          note: `${sum.waitPercent}% dari seluruh waktu`,
        },
        { label: 'Tarif RS', value: rp(bill.total), note: `${sum.chargeLines} baris tagihan otomatis` },
        {
          label: 'Dibayar pasien',
          value: bill.patient === null ? 'Belum difinalkan' : rp(bill.patient),
          note: R.rec.penjamin,
        },
        { label: 'Pesan ke BPJS', value: String(sum.counts.bpjs), note: 'VClaim, antrean, E-Klaim' },
        {
          label: 'Kiriman SATUSEHAT',
          value: String(sum.counts.satusehat),
          note: 'Encounter, Observation, dll.',
        },
        {
          label: 'Gerbang keselamatan',
          value: String(sum.counts.keselamatan),
          note: 'CDS, nilai kritis, override',
        },
        {
          label: 'Jejak audit',
          value: String(sum.auditEvents),
          note: 'kejadian tercatat dengan jam dan peran',
        },
        ...sum.extra.map((x) => ({ label: x.label, value: rp(x.value), note: x.note })),
      ],
      bars: sum.bars.map((b) => ({
        stage: b.stage,
        waitPct: Math.round((b.wait / maxT) * 1000) / 10,
        servicePct: Math.max(Math.round((b.service / maxT) * 1000) / 10, 0.8),
        text: `${formatSimDuration(b.wait)} jeda · ${formatSimDuration(b.service)} kerja`,
      })),
      auto: [...def.auto],
    };
  }

  const counts = integrationCounts(R);
  return {
    scenario: { id: def.id, label: def.label },
    patient: {
      initials: R.rec.initials,
      nama: R.rec.nama,
      meta: `${R.rec.jk} · ${R.rec.umur} th · RM ${R.rec.rm} · ${scenarioName(def)}`,
      alergi: `Alergi: ${R.rec.alergi}`,
      riwayat: R.rec.riwayat,
      penjamin: R.rec.penjamin,
      lokasi: R.rec.lokasi,
    },
    clock: {
      text: fmt(R.clock),
      sub: `${def.showDay ? '' : `${formatSimDate(def)} · `}berjalan ${formatSimDuration(R.clock - def.startMin)}`,
    },
    journey,
    progress,
    step,
    summary,
    record: recordRows(R),
    integration: [
      { kind: 'bpjs', label: 'Pesan BPJS', value: counts.bpjs },
      { kind: 'satusehat', label: 'Kirim SATUSEHAT', value: counts.satusehat },
      { kind: 'pembayaran', label: 'Pesan TPDI · BTN', value: counts.pembayaran },
      { kind: 'keselamatan', label: 'Gerbang keselamatan', value: counts.keselamatan },
    ],
    bpjsTasks:
      def.id === 'rawat-jalan'
        ? bpjsQueueTasks(R).map((t) => ({ n: t.n, name: t.name, time: t.at === null ? null : fmt(t.at) }))
        : null,
    charges: R.charges.map((c) => ({ name: c.name, src: c.src, amount: rp(c.amount) })),
    bill: {
      total: rp(bill.total),
      covered: bill.covered === null ? 'Belum difinalkan' : rp(bill.covered),
      patient: bill.patient === null ? 'Belum difinalkan' : rp(bill.patient),
    },
    logs: R.logs
      .map((l, i) => ({
        key: `${i}`,
        time: fmt(l.t),
        actor: l.actor,
        text: l.text,
        sys: l.sys,
        kind: logKind(l.sys),
      }))
      .reverse(),
    finished: R.finished,
    activeStep: R.step,
    stepsCount: N,
  };
}
