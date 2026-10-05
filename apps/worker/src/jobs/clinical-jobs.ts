import type { PeriodicJob } from './periodic-job-types';

/** Draf disimpan sampai 48 jam setelah kunjungan selesai/batal (dokumentasi susulan, ADR-0031 butir 3). */
export const DRAFT_RETENTION_MS = 48 * 3_600_000;

/**
 * K · Bersihkan draf klinis (ADR-0028 butir 5: bukan rekam medis, berisi PHI) milik kunjungan yang sudah selesai atau
 * batal lebih dari `DRAFT_RETENTION_MS`. Entri final tidak tersentuh (tabel berversi tidak bisa dihapus). Idempoten.
 */
export const clinicalDraftsCleanupJob: PeriodicJob = {
  schedule: { everyMs: 3_600_000 },
  async run({ now, tx }) {
    const before = new Date(now.getTime() - DRAFT_RETENTION_MS);
    await tx((t) =>
      t.clinicalDraft.deleteMany({
        where: {
          encounter: {
            status: { in: ['finished', 'cancelled'] },
            OR: [{ endedAt: { lt: before } }, { endedAt: null, updatedAt: { lt: before } }],
          },
        },
      }),
    );
  },
};
