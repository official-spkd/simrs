import { z } from 'zod';
import { defineDomain } from './demo/store/define';
import { BACKUP_LOCATIONS, BACKUP_RUNS, LAST_RESTORE_TEST } from './demo/fixtures/operasional';
import {
  addManualCopy,
  type BackupLocation,
  type BackupRun,
  initialRestore,
  RESTORE_STEPS,
  restorePassed,
  type RestoreState,
  stepRestore,
} from './operasional-backup';

/**
 * Fase 10 · Domain toko demo `cadangan` (ADR-0085, ADR-0071): backup manual beralasan dan uji restore langkah demi
 * langkah (bisa gagal aman dengan kunci salah). Hasil uji lulus memperbarui RTO terakhir. Aturan murni → `generic`.
 */

export const BACKUP_DOMAIN = 'cadangan';

const at = z.iso.datetime({ offset: true });
const jam = z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/);

export const backupEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('backup.manual'), reason: z.string().max(300), at, jam }),
  z.strictObject({ type: z.literal('restore.langkah'), wrongKey: z.boolean(), at, jam }),
  z.strictObject({ type: z.literal('restore.ulang'), jam }),
]);
export type BackupEvent = z.infer<typeof backupEventSchema>;

export interface BackupStoreState {
  locations: readonly BackupLocation[];
  runs: readonly BackupRun[];
  restore: RestoreState;
  /** Kunci salah dipilih saat uji berjalan (dikunci sampai uji diulang). */
  wrongKey: boolean;
  restoreLog: ReadonlyArray<{ t: string; text: string }>;
  lastTest: { at: string; rtoMinutes: number; source: string };
}

function gate(s: BackupStoreState, ev: BackupEvent): string | null {
  switch (ev.type) {
    case 'backup.manual':
      return ev.reason.trim().length < 5 ? 'Alasan backup manual wajib diisi.' : null;
    case 'restore.langkah':
      if (s.restore.failedAt !== null) return 'Uji restore gagal; ulang uji dari awal.';
      if (restorePassed(s.restore)) return 'Uji restore sudah lulus.';
      if (s.restore.next > 0 && ev.wrongKey !== s.wrongKey)
        return 'Pilihan kunci tidak bisa diubah di tengah uji.';
      return null;
    case 'restore.ulang':
      return s.restore.next === 0 && s.restore.failedAt === null ? 'Uji restore belum dimulai.' : null;
  }
}

export const backupDomain = defineDomain<BackupStoreState, BackupEvent>(BACKUP_DOMAIN, {
  initial: () => ({
    locations: BACKUP_LOCATIONS.map((l) => ({ ...l, kept: { ...l.kept } })),
    runs: [...BACKUP_RUNS],
    restore: initialRestore(),
    wrongKey: false,
    restoreLog: [],
    lastTest: { ...LAST_RESTORE_TEST },
  }),
  eventSchema: backupEventSchema,
  screens: ['cadangan'],
  generic: true,
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d);
    if (err) throw new Error(err);
    const by = ev.actor.name;
    switch (d.type) {
      case 'backup.manual':
        return {
          ...s,
          runs: [
            {
              id: `bk-manual-${s.runs.length + 1}`,
              at: d.at,
              kind: 'manual',
              status: 'success',
              durationSec: 2,
              note: `Manual: ${d.reason.trim()} (${by})`,
            },
            ...s.runs,
          ],
          locations: s.locations.map((l) => ({ ...addManualCopy(l), lastOkAt: d.at })),
        };
      case 'restore.langkah': {
        const step = RESTORE_STEPS[s.restore.next];
        const next = stepRestore(s.restore, d.wrongKey);
        const text =
          next.failedAt !== null ? `Gagal di “${step?.label ?? ''}”` : `Lulus: ${step?.label ?? ''}`;
        return {
          ...s,
          restore: next,
          wrongKey: d.wrongKey,
          restoreLog: [{ t: d.jam, text: `${text} (${by})` }, ...s.restoreLog],
          lastTest: restorePassed(next)
            ? { at: d.at, rtoMinutes: next.minutes, source: 'cloud utama' }
            : s.lastTest,
        };
      }
      case 'restore.ulang':
        return { ...s, restore: initialRestore(), wrongKey: false, restoreLog: [] };
    }
  },
});
