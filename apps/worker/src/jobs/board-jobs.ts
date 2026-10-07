import type { PeriodicJob } from './periodic-job-types';

/** Sinyal papan IGD/bed disimpan 1 jam: cukup untuk menelusuri, sinyal hanya pemicu muat ulang (ADR-0104). */
export const BOARD_SIGNAL_RETENTION_MS = 3_600_000;
/** Baris per transaksi (kunci pendek; trigger papan tetap bisa menulis di sela batch). */
export const BOARD_SIGNAL_PURGE_BATCH = 1000;
/** Batch per putaran per tenant; sisanya diambil putaran berikutnya. */
export const BOARD_SIGNAL_PURGE_MAX_BATCHES = 20;

/**
 * K03/K05 · Bersihkan `board_signals` (ADR-0104) yang lebih tua dari `BOARD_SIGNAL_RETENTION_MS`, per batch kecil,
 * lewat fungsi sempit `app_purge_board_signals` (SECURITY DEFINER; role aplikasi tidak punya DELETE; fungsi
 * menolak menghapus sinyal < 10 menit). Idempoten.
 */
export const boardSignalsCleanupJob: PeriodicJob = {
  schedule: { everyMs: 15 * 60_000 },
  async run({ now, tx }) {
    const before = new Date(now.getTime() - BOARD_SIGNAL_RETENTION_MS);
    for (let i = 0; i < BOARD_SIGNAL_PURGE_MAX_BATCHES; i++) {
      const [row] = await tx(
        (t) =>
          t.$queryRaw<Array<{ n: number }>>`
          SELECT app_purge_board_signals(${before}::timestamptz, ${BOARD_SIGNAL_PURGE_BATCH}::int) AS n`,
      );
      if ((row?.n ?? 0) < BOARD_SIGNAL_PURGE_BATCH) return;
    }
  },
};
