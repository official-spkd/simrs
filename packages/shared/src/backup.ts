import { z } from 'zod';
import { formatJam, isoDateJakarta, jakartaParts } from './datetime';

/**
 * Fase 10 · Ringkasan status backup untuk RS (ADR-0071): hasil fungsi DB `app_backup_status()`, tanpa lokasi bucket,
 * kunci, ukuran, atau teks galat. Dipakai layar Integrasi (kontrak `integrationOverviewSchema.backups`).
 */
const isoDateTime = z.iso.datetime({ offset: true });

export const BACKUP_RUN_STATUSES = ['success', 'partial', 'failed'] as const;
export const RESTORE_TEST_STATUSES = ['success', 'failed'] as const;

export const backupStatusSchema = z.strictObject({
  lastRunAt: isoDateTime.nullable(),
  lastRunStatus: z.enum(BACKUP_RUN_STATUSES).nullable(),
  lastSuccessAt: isoDateTime.nullable(),
  localOkAt: isoDateTime.nullable(),
  cloudOkAt: isoDateTime.nullable(),
  offsiteOkAt: isoDateTime.nullable(),
  failedLast24h: z.number().int().min(0),
  lastRestoreTestAt: isoDateTime.nullable(),
  lastRestoreTestStatus: z.enum(RESTORE_TEST_STATUSES).nullable(),
  lastRestoreRtoSeconds: z.number().int().min(0).nullable(),
});
export type BackupStatus = z.infer<typeof backupStatusSchema>;

/** Backup per jam: lokasi dianggap terlambat bila salinan berhasil terakhir lebih tua dari ini. */
export const BACKUP_STALE_HOURS = 2;
/** Uji restore mingguan: terlambat bila lebih dari 8 hari. */
export const RESTORE_TEST_STALE_DAYS = 8;

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;

function tanggalPendek(at: string): string {
  const p = jakartaParts(at);
  return `${p.day} ${BULAN[p.month - 1]}`;
}

/** `10.00` bila hari ini (WIB), selain itu `4 Okt 10.00`. */
function waktu(at: string, now: Date): string {
  return isoDateJakarta(at) === isoDateJakarta(now) ? formatJam(at) : `${tanggalPendek(at)} ${formatJam(at)}`;
}

export interface BackupStatusItem {
  id: 'edge' | 'cloud' | 'offsite';
  label: string;
  detail: string;
}

/**
 * Tiga baris aturan 3-2-1 untuk layar Integrasi, format sama dengan data presentasi (`10.00 · berhasil`). Status
 * tidak hanya lewat warna: kata "terlambat"/"gagal"/"belum ada" selalu tertulis.
 */
export function backupStatusItems(status: BackupStatus, now: Date = new Date()): BackupStatusItem[] {
  const location = (at: string | null): string => {
    if (!at) return 'belum ada backup berhasil';
    const stale = now.getTime() - new Date(at).getTime() > BACKUP_STALE_HOURS * 3_600_000;
    return `${waktu(at, now)} · ${stale ? 'terlambat' : 'berhasil'}`;
  };
  let restore = 'uji restore belum pernah';
  if (status.lastRestoreTestAt) {
    const late =
      now.getTime() - new Date(status.lastRestoreTestAt).getTime() > RESTORE_TEST_STALE_DAYS * 86_400_000;
    const tgl = tanggalPendek(status.lastRestoreTestAt);
    restore =
      status.lastRestoreTestStatus === 'success'
        ? `uji restore ${tgl}${late ? ' (terlambat)' : ''}`
        : `uji restore GAGAL ${tgl}`;
  }
  const lastFailed = status.lastRunStatus !== null && status.lastRunStatus !== 'success';
  return [
    { id: 'edge', label: 'Lokal server edge', detail: location(status.localOkAt) },
    {
      id: 'cloud',
      label: 'Cloud utama',
      detail: `${location(status.cloudOkAt)}${lastFailed ? ' · run terakhir gagal' : ''}`,
    },
    { id: 'offsite', label: 'Offsite terenkripsi', detail: `${location(status.offsiteOkAt)} · ${restore}` },
  ];
}
