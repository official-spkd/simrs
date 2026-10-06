/**
 * P13 · Mode downtime dan sinkron edge (mode presentasi, ADR-0023; rencana fase 10 §10.5–10.6). Mesin keadaan murni
 * dengan jam simulasi (menit sejak mulai latihan) agar durasi gangguan dan RTO terbaca wajar saat presentasi:
 * normal → downtime aktif (alasan wajib) → cetak paket darurat (wajib SOP) → pulih → entri susulan dari formulir
 * kertas (alasan + waktu klinis asli) → sinkron antrean kirim per batch berkunci idempoten → selesai.
 */

export type DowntimeCause = 'bpjs' | 'jaringan';
export type DowntimeStage = 0 | 1 | 2 | 3 | 4;

export const STAGES = [
  'Normal',
  'Downtime aktif',
  'Pulih · entri susulan',
  'Sinkronisasi',
  'Selesai',
] as const;

export const CAUSE_LABEL: Record<DowntimeCause, string> = {
  bpjs: 'BPJS tidak menjawab',
  jaringan: 'Jaringan ke server pusat putus',
};

export interface PaperForm {
  id: string;
  form: string;
  patient: string;
  /** Menit sejak downtime mulai (waktu klinis asli di kertas). */
  offset: number;
  by: string;
}

export interface Backlog {
  sep: number;
  task: number;
  satusehat: number;
}

export interface DowntimeState {
  stage: DowntimeStage;
  /** Menit simulasi sejak jam mulai layar. */
  clock: number;
  cause: DowntimeCause;
  reason: string;
  startedAt: number | null;
  recoveredAt: number | null;
  printedAt: number | null;
  offlineRegistrations: number;
  backlog: Backlog;
  peak: number;
  backEntries: Record<string, number>;
  syncLog: Array<{ at: number; sent: number; left: number }>;
}

export const initialDowntime = (): DowntimeState => ({
  stage: 0,
  clock: 0,
  cause: 'bpjs',
  reason: '',
  startedAt: null,
  recoveredAt: null,
  printedAt: null,
  offlineRegistrations: 0,
  backlog: { sep: 0, task: 0, satusehat: 0 },
  peak: 0,
  backEntries: {},
  syncLog: [],
});

export const backlogTotal = (b: Backlog) => b.sep + b.task + b.satusehat;
export const SYNC_BATCH = 12;
export const MAX_OFFLINE = 3;
export const MIN_REASON = 10;

export type DowntimeAction =
  | { type: 'activate'; cause: DowntimeCause; reason: string }
  | { type: 'print' }
  | { type: 'offline-registration' }
  | { type: 'tick' }
  | { type: 'recover' }
  | { type: 'back-entry'; id: string; reason: string }
  | { type: 'sync' }
  | { type: 'reset' };

export type Check = { ok: true } | { ok: false; reason: string };

export function canDo(s: DowntimeState, a: DowntimeAction, forms: readonly PaperForm[]): Check {
  switch (a.type) {
    case 'activate':
      if (s.stage !== 0) return { ok: false, reason: 'Downtime sudah berjalan.' };
      return a.reason.trim().length < MIN_REASON
        ? { ok: false, reason: `Tulis alasan dan dampak minimal ${MIN_REASON} huruf.` }
        : { ok: true };
    case 'print':
      if (s.stage !== 1) return { ok: false, reason: 'Paket darurat hanya dicetak saat downtime aktif.' };
      return s.printedAt !== null ? { ok: false, reason: 'Paket sudah dicetak.' } : { ok: true };
    case 'offline-registration':
      if (s.stage !== 1) return { ok: false, reason: 'Hanya saat downtime aktif.' };
      return s.offlineRegistrations >= MAX_OFFLINE
        ? { ok: false, reason: `Contoh dibatasi ${MAX_OFFLINE} pasien.` }
        : { ok: true };
    case 'tick':
      return s.stage === 1 ? { ok: true } : { ok: false, reason: 'Hanya saat downtime aktif.' };
    case 'recover':
      if (s.stage !== 1) return { ok: false, reason: 'Downtime belum aktif.' };
      return s.printedAt === null
        ? { ok: false, reason: 'Cetak paket darurat dulu (langkah wajib SOP).' }
        : { ok: true };
    case 'back-entry':
      if (s.stage !== 2) return { ok: false, reason: 'Entri susulan dimasukkan setelah layanan pulih.' };
      if (s.backEntries[a.id] !== undefined) return { ok: false, reason: 'Sudah dimasukkan.' };
      return a.reason.trim().length < MIN_REASON
        ? { ok: false, reason: `Alasan entri susulan minimal ${MIN_REASON} huruf.` }
        : { ok: true };
    case 'sync': {
      if (s.stage === 2) {
        const left = forms.filter((f) => s.backEntries[f.id] === undefined).length;
        return left > 0 ? { ok: false, reason: `${left} formulir kertas belum dimasukkan.` } : { ok: true };
      }
      return s.stage === 3 ? { ok: true } : { ok: false, reason: 'Sinkron setelah layanan pulih.' };
    }
    case 'reset':
      return { ok: true };
  }
}

function withBacklog(s: DowntimeState, b: Backlog): DowntimeState {
  return { ...s, backlog: b, peak: Math.max(s.peak, backlogTotal(b)) };
}

/** Terapkan aksi bila diizinkan `canDo`; selain itu keadaan tidak berubah. */
export function reduceDowntime(
  s: DowntimeState,
  a: DowntimeAction,
  forms: readonly PaperForm[],
): DowntimeState {
  if (!canDo(s, a, forms).ok) return s;
  switch (a.type) {
    case 'activate': {
      const clock = s.clock + 1;
      return {
        ...initialDowntime(),
        stage: 1,
        clock,
        cause: a.cause,
        reason: a.reason.trim(),
        startedAt: clock,
      };
    }
    case 'print':
      return { ...s, clock: s.clock + 2, printedAt: s.clock + 2 };
    case 'offline-registration':
      return withBacklog(
        { ...s, clock: s.clock + 3, offlineRegistrations: s.offlineRegistrations + 1 },
        { sep: s.backlog.sep + 1, task: s.backlog.task + 2, satusehat: s.backlog.satusehat + 1 },
      );
    case 'tick':
      return withBacklog(
        { ...s, clock: s.clock + 15 },
        { ...s.backlog, task: s.backlog.task + 6, satusehat: s.backlog.satusehat + 5 },
      );
    case 'recover': {
      const clock = s.clock + 5;
      return withBacklog(
        { ...s, stage: 2, clock, recoveredAt: clock },
        { ...s.backlog, sep: s.backlog.sep + 2, task: s.backlog.task + 4 },
      );
    }
    case 'back-entry':
      return withBacklog(
        { ...s, clock: s.clock + 2, backEntries: { ...s.backEntries, [a.id]: s.clock + 2 } },
        { ...s.backlog, satusehat: s.backlog.satusehat + 1 },
      );
    case 'sync': {
      let n = Math.min(SYNC_BATCH, backlogTotal(s.backlog));
      const sent = n;
      const b = { ...s.backlog };
      for (const k of ['sep', 'task', 'satusehat'] as const) {
        const d = Math.min(n, b[k]);
        b[k] -= d;
        n -= d;
      }
      const clock = s.clock + 2;
      const left = backlogTotal(b);
      return {
        ...s,
        clock,
        stage: left === 0 ? 4 : 3,
        backlog: b,
        syncLog: [...s.syncLog, { at: clock, sent, left }],
      };
    }
    case 'reset':
      return { ...initialDowntime(), clock: s.clock };
  }
}

/** Ringkasan insiden (MRMIK 13.1c): lama gangguan, pemulihan, pesan tersinkron, data hilang. */
export function incidentSummary(s: DowntimeState) {
  if (s.startedAt === null || s.recoveredAt === null) return null;
  const last = s.syncLog.at(-1);
  return {
    outageMinutes: s.recoveredAt - s.startedAt,
    recoveryMinutes: last ? last.at - s.recoveredAt : 0,
    messagesSynced: s.syncLog.reduce((n, x) => n + x.sent, 0),
    dataLost: 0,
  };
}
