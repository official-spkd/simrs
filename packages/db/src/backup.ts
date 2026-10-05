import { type BackupStatus, backupStatusSchema } from '@simrs/shared';
import type { TenantTx } from './client';

interface BackupStatusRow {
  last_run_at: Date | null;
  last_run_status: string | null;
  last_success_at: Date | null;
  local_ok_at: Date | null;
  cloud_ok_at: Date | null;
  offsite_ok_at: Date | null;
  failed_last_24h: number;
  last_restore_test_at: Date | null;
  last_restore_test_status: string | null;
  last_restore_rto_seconds: number | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Fase 10 · Ringkasan backup untuk RS mana pun (ADR-0071), lewat fungsi SECURITY DEFINER sempit `app_backup_status()`:
 * hanya waktu dan status, tanpa lokasi/kunci/ukuran. Dipanggil di transaksi bertenant (`withTenant`); konteks tenant
 * pemanggil dipulihkan oleh fungsi. Untuk endpoint layar Integrasi (fase 7).
 */
export async function readBackupStatus(tx: TenantTx): Promise<BackupStatus> {
  const [row] = await tx.$queryRaw<BackupStatusRow[]>`SELECT * FROM app_backup_status()`;
  if (!row) throw new Error('app_backup_status tidak mengembalikan baris');
  return backupStatusSchema.parse({
    lastRunAt: iso(row.last_run_at),
    lastRunStatus: row.last_run_status,
    lastSuccessAt: iso(row.last_success_at),
    localOkAt: iso(row.local_ok_at),
    cloudOkAt: iso(row.cloud_ok_at),
    offsiteOkAt: iso(row.offsite_ok_at),
    failedLast24h: Number(row.failed_last_24h),
    lastRestoreTestAt: iso(row.last_restore_test_at),
    lastRestoreTestStatus: row.last_restore_test_status,
    lastRestoreRtoSeconds: row.last_restore_rto_seconds,
  });
}
