import type { PeriodicJob } from '../jobs/periodic-job-types';
import type { AuditAnchorJob } from './audit-anchor.job';
import type { AuditSummaryJob } from './audit-summary.job';

/**
 * Job berkala P04 di registri P11 (ADR-0072), per tenant aktif:
 * - `audit.anchor` tiap jam: rekonsiliasi bucket WORM, periksa sejak titik periksa, tulis jangkar (tanpa kunci =
 *   tidak berbuat apa-apa);
 * - `audit.daily-summary` pukul 00.20 WIB: ringkas hari yang sudah final dan belum diringkas dengan parameter
 *   sekarang (90 hari ke belakang; idempoten). Tidak berjalan saat worker baru menyala (E2E, pengembangan).
 */
export function auditPeriodicJobs(
  anchors: AuditAnchorJob,
  summaries: AuditSummaryJob,
): Array<[string, PeriodicJob]> {
  return [
    [
      'audit.anchor',
      {
        schedule: { everyMs: 60 * 60_000 },
        run: async ({ tenantId }) => {
          await anchors.runTenant(tenantId);
        },
      },
    ],
    [
      'audit.daily-summary',
      {
        schedule: { dailyAt: '00:20' },
        run: async ({ tenantId, now }) => {
          await summaries.summarizeTenant(tenantId, now);
        },
      },
    ],
  ];
}
