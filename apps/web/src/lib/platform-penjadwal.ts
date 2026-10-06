/**
 * P11 · Penjadwal pekerjaan (mode presentasi, ADR-0023): job berkala RS (outbox, backup, jangkar audit, sinkron
 * master, laporan, pengingat). Logika murni: kesehatan job dari hasil terakhir + jadwal, ringkasan, dan gerbang
 * "jalankan sekarang" (job dijeda/berjalan tidak bisa; job berisiko wajib alasan).
 */

export type RunResult = 'berhasil' | 'gagal';

export interface JobRun {
  at: string;
  durationSec: number;
  result: RunResult;
  message: string;
  manual?: boolean;
}

export interface ScheduledJob {
  id: string;
  name: string;
  /** Jadwal dalam bahasa petugas, mis. "Tiap 15 menit". */
  schedule: string;
  /** Selang antar-jalan (menit) untuk menghitung keterlambatan. */
  intervalMin: number;
  /** Komponen pemilik (katalog docs/02). */
  owner: string;
  paused: boolean;
  pausedReason?: string;
  /** Jalan manual menyentuh pihak luar/data besar: wajib alasan. */
  sensitive: boolean;
  nextAt: string;
  /** Terbaru di depan. */
  runs: JobRun[];
}

export type JobHealth = 'berhasil' | 'gagal' | 'terlambat' | 'dijeda';

export const HEALTH_LABEL: Record<JobHealth, string> = {
  berhasil: 'Berhasil',
  gagal: 'Gagal',
  terlambat: 'Terlambat',
  dijeda: 'Dijeda',
};

/** Terlambat = jalan berhasil terakhir lebih tua dari 2× selang jadwal. */
export function jobHealth(job: ScheduledJob, now: Date): JobHealth {
  if (job.paused) return 'dijeda';
  const last = job.runs[0];
  if (!last) return 'terlambat';
  if (last.result === 'gagal') return 'gagal';
  const age = (now.getTime() - Date.parse(last.at)) / 60_000;
  return age > job.intervalMin * 2 ? 'terlambat' : 'berhasil';
}

export function jobSummary(jobs: readonly ScheduledJob[], now: Date) {
  const health = jobs.map((j) => jobHealth(j, now));
  const since = now.getTime() - 24 * 3_600_000;
  return {
    total: jobs.length,
    active: jobs.filter((j) => !j.paused).length,
    failing: health.filter((h) => h === 'gagal').length,
    late: health.filter((h) => h === 'terlambat').length,
    paused: health.filter((h) => h === 'dijeda').length,
    failedRuns24h: jobs
      .flatMap((j) => j.runs)
      .filter((r) => r.result === 'gagal' && Date.parse(r.at) >= since).length,
  };
}

export type Check = { ok: true } | { ok: false; reason: string };

export function canRunNow(job: ScheduledJob, running: boolean): Check {
  if (running) return { ok: false, reason: 'Job sedang berjalan; tunggu sampai selesai.' };
  if (job.paused) return { ok: false, reason: 'Job dijeda; lanjutkan dulu sebelum menjalankan.' };
  return { ok: true };
}

/** Catat hasil jalan manual di depan riwayat (maks. 8 baris). */
export function recordRun(job: ScheduledJob, run: JobRun): ScheduledJob {
  return { ...job, runs: [run, ...job.runs].slice(0, 8) };
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} dtk`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} mnt ${s} dtk` : `${m} mnt`;
}
