import { bookingNoShowJob, bookingReminderJob } from './booking-jobs';
import type { PeriodicJob } from './periodic-job-types';
import { generateSessionsJob, hfisPullJob } from './scheduling-jobs';

export type {
  PeriodicJob,
  PeriodicJobContext,
  PeriodicRunSummary,
  PeriodicSchedule,
} from './periodic-job-types';

/** Token DI peta job (tes boleh menggantinya). */
export const PERIODIC_JOB_REGISTRY = Symbol('PERIODIC_JOB_REGISTRY');

/**
 * Peta job berkala per tenant (P11). Nama = kunci jadwal BullMQ, jadi jangan diganti setelah dipakai.
 * Potongan fase 2 menambahkan satu baris per job, mis.:
 * `scheduling.generate-sessions` (harian), `scheduling.hfis-pull`, `booking.no-show`, `booking.reminder`.
 * Memakai Map (bukan objek) agar nama seperti `constructor` tidak cocok dengan properti bawaan.
 */
export const PERIODIC_JOBS: ReadonlyMap<string, PeriodicJob> = new Map<string, PeriodicJob>([
  ['booking.no-show', bookingNoShowJob],
  ['booking.reminder', bookingReminderJob],
  ['scheduling.generate-sessions', generateSessionsJob],
  ['scheduling.hfis-pull', hfisPullJob],
]);
