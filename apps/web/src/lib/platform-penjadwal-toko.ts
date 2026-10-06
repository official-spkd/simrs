import { z } from 'zod';
import { defineDomain } from './demo/store/define';
import { DEMO_JOBS } from './demo/fixtures/penjadwal';
import { canRunNow, recordRun, type ScheduledJob } from './platform-penjadwal';

/**
 * P11 · Domain toko demo `penjadwal` (ADR-0085): jalan manual (alasan wajib untuk job berisiko), jeda beralasan,
 * dan lanjutkan job berkala. Hasil jalan manual tercatat di riwayat job atas nama pengguna sesi. Aturan murni →
 * `generic`.
 */

export const JOBS_DOMAIN = 'penjadwal';

/** Pesan hasil jalan manual yang berhasil (mock pihak luar sudah pulih). */
export const RERUN_MESSAGE: Readonly<Record<string, string>> = {
  'aplicare-bed': '8 kelas rawat terkirim (Aplicare pulih)',
  'laporan-rl': 'RL 3.1 September terkirim ulang setelah koreksi koding; tanda terima SIRS diterima',
};

const jobId = z.string().min(1).max(60);
const jam = z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/);
const MIN_REASON = 5;

export const jobsEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('job.dijalankan'),
    id: jobId,
    reason: z.string().max(300),
    /** Saat selesai (jam hari demo, ISO). */
    at: z.iso.datetime({ offset: true }),
    jam,
  }),
  z.strictObject({ type: z.literal('job.dijeda'), id: jobId, reason: z.string().max(300), jam }),
  z.strictObject({ type: z.literal('job.dilanjutkan'), id: jobId, jam }),
]);
export type JobsEvent = z.infer<typeof jobsEventSchema>;

export interface JobsStoreState {
  jobs: readonly ScheduledJob[];
}

function gate(s: JobsStoreState, ev: JobsEvent): string | null {
  const job = s.jobs.find((j) => j.id === ev.id);
  if (!job) return 'Job tidak ditemukan.';
  switch (ev.type) {
    case 'job.dijalankan': {
      const c = canRunNow(job, false);
      if (!c.ok) return c.reason;
      return job.sensitive && ev.reason.trim().length < MIN_REASON
        ? 'Job ini menyentuh pihak luar atau data besar: alasan wajib.'
        : null;
    }
    case 'job.dijeda':
      if (job.paused) return 'Job sudah dijeda.';
      return ev.reason.trim().length < MIN_REASON ? 'Alasan menjeda wajib diisi.' : null;
    case 'job.dilanjutkan':
      return job.paused ? null : 'Job tidak sedang dijeda.';
  }
}

export const jobsDomain = defineDomain<JobsStoreState, JobsEvent>(JOBS_DOMAIN, {
  initial: () => ({ jobs: DEMO_JOBS.map((j) => ({ ...j, runs: [...j.runs] })) }),
  eventSchema: jobsEventSchema,
  screens: ['penjadwal'],
  generic: true,
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d);
    if (err) throw new Error(err);
    const by = ev.actor.name;
    return {
      jobs: s.jobs.map((j) => {
        if (j.id !== d.id) return j;
        switch (d.type) {
          case 'job.dijalankan': {
            const base = RERUN_MESSAGE[j.id] ?? j.runs[0]?.message ?? 'Selesai';
            const why = d.reason.trim() ? ` · alasan: ${d.reason.trim()}` : '';
            return recordRun(j, {
              at: d.at,
              durationSec: 2,
              result: 'berhasil',
              message: `${base} · dijalankan ${by}${why}`,
              manual: true,
            });
          }
          case 'job.dijeda':
            return { ...j, paused: true, pausedReason: `${d.reason.trim()} (${by}, ${d.jam})` };
          case 'job.dilanjutkan':
            return { ...j, paused: false, pausedReason: undefined };
        }
      }),
    };
  },
});
