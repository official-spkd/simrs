import { enqueueHfisPull, generateScheduleSessions, readTenantSetting } from '@simrs/db';
import { isoDateJakarta } from '@simrs/shared';
import type { PeriodicJob } from './periodic-job-types';

/** Rentang tarik HFIS harian (hari mulai hari ini). */
export const HFIS_PULL_DAYS = 14;

/**
 * F01 · Bangkitkan sesi praktik dari templat untuk `booking.max_days_ahead` hari (bawaan 30) mulai hari ini (WIB).
 * Idempoten: sesi yang sudah ada tidak disentuh (kuota diubah petugas, cuti, booking tetap).
 */
export const generateSessionsJob: PeriodicJob = {
  schedule: { dailyAt: '01:00' },
  module: 'F01',
  async run(ctx) {
    await ctx.tx(async (tx) => {
      const days = await readTenantSetting(tx, 'booking.max_days_ahead');
      await generateScheduleSessions(tx, ctx.tenantId, { from: isoDateJakarta(ctx.now), days });
    });
  },
};

/**
 * F01 · Tarik jadwal HFIS 14 hari ke depan lewat outbox (`bpjs.hfis.pull` per poli × tanggal), bahan panel perbedaan
 * RS vs HFIS. Job tidak memanggil BPJS sendiri; worker mengirim pesannya seperti outbox lain.
 */
export const hfisPullJob: PeriodicJob = {
  schedule: { dailyAt: '05:00' },
  module: 'F01',
  async run(ctx) {
    await ctx.tx((tx) =>
      enqueueHfisPull(tx, ctx.tenantId, {
        from: isoDateJakarta(ctx.now),
        days: HFIS_PULL_DAYS,
        now: ctx.now,
      }),
    );
  },
};
