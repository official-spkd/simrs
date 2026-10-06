import { BACKUP_STALE_HOURS, RESTORE_TEST_STALE_DAYS } from '@simrs/shared';

/**
 * Fase 10 · Cadangan dan pemulihan (ADR-0071), mode presentasi: tiga lokasi (disk edge, cloud utama, offsite),
 * retensi per lokasi (48 per jam, 35 harian, 12 bulanan, 10 manual), dan uji restore berurutan yang gagal keras
 * sebelum ada plaintext bila manifest rusak atau kunci salah. RTO terukur = mulai sampai langkah terakhir lolos.
 */

export type BackupLocationId = 'edge' | 'cloud' | 'offsite';

export interface BackupLocation {
  id: BackupLocationId;
  label: string;
  where: string;
  schedule: string;
  lastOkAt: string;
  sizeLabel: string;
  /** Jumlah salinan tersimpan per kelas retensi. */
  kept: Record<RetentionClass, number>;
}

export type RetentionClass = 'jam' | 'harian' | 'bulanan' | 'manual';
export const RETENTION_LIMIT: Record<RetentionClass, number> = {
  jam: 48,
  harian: 35,
  bulanan: 12,
  manual: 10,
};
export const RETENTION_LABEL: Record<RetentionClass, string> = {
  jam: 'per jam',
  harian: 'harian',
  bulanan: 'bulanan',
  manual: 'manual',
};

export type RunStatus = 'success' | 'partial' | 'failed';
export const RUN_LABEL: Record<RunStatus, string> = {
  success: 'Berhasil · 3 lokasi',
  partial: 'Sebagian · lokasi jauh gagal',
  failed: 'Gagal',
};

export interface BackupRun {
  id: string;
  at: string;
  kind: 'jam' | 'harian' | 'manual';
  status: RunStatus;
  durationSec: number;
  note: string;
}

/** Lokasi terlambat bila salinan berhasil terakhir lebih tua dari `BACKUP_STALE_HOURS` (sama dengan layar Integrasi). */
export function locationStale(loc: BackupLocation, now: Date): boolean {
  return now.getTime() - Date.parse(loc.lastOkAt) > BACKUP_STALE_HOURS * 3_600_000;
}

export function restoreTestStale(lastAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(lastAt) > RESTORE_TEST_STALE_DAYS * 86_400_000;
}

/** Tambah salinan manual: retensi membuang yang tertua bila melewati batas (jumlah tidak pernah lewat batas). */
export function addManualCopy(loc: BackupLocation): BackupLocation {
  return { ...loc, kept: { ...loc.kept, manual: Math.min(RETENTION_LIMIT.manual, loc.kept.manual + 1) } };
}

export interface RestoreStep {
  id: string;
  label: string;
  detail: string;
  /** Menit simulasi yang dipakai langkah ini (RTO). */
  minutes: number;
}

export const RESTORE_STEPS: readonly RestoreStep[] = [
  { id: 'ambil', label: 'Ambil backup lengkap terbaru', detail: 'Dari bucket cloud utama', minutes: 3 },
  {
    id: 'manifest',
    label: 'Periksa manifest dan checksum',
    detail: 'Manifest rusak/diubah = gagal keras',
    minutes: 1,
  },
  {
    id: 'kunci',
    label: 'Cocokkan kunci privat',
    detail: 'Dua pemegang kunci; kunci salah gagal sebelum ada plaintext',
    minutes: 2,
  },
  {
    id: 'dekripsi',
    label: 'Dekripsi ke folder kerja baru',
    detail: 'Hash plaintext harus cocok',
    minutes: 4,
  },
  {
    id: 'pulihkan',
    label: 'Pulihkan ke database bersih',
    detail: 'Kontainer baru, pg_restore satu transaksi',
    minutes: 18,
  },
  { id: 'migrasi', label: 'Cek versi skema', detail: 'Daftar migrasi = manifest', minutes: 1 },
  {
    id: 'baris',
    label: 'Cocokkan jumlah baris per tabel',
    detail: 'Dibandingkan dengan manifest',
    minutes: 3,
  },
  {
    id: 'layanan',
    label: 'Layanan siap + verifikasi rantai audit',
    detail: '/ready 200 dan kepala rantai = manifest',
    minutes: 4,
  },
];

export interface RestoreState {
  /** Indeks langkah berikutnya; `RESTORE_STEPS.length` = lulus. */
  next: number;
  minutes: number;
  failedAt: number | null;
  failReason: string | null;
}

export const initialRestore = (): RestoreState => ({ next: 0, minutes: 0, failedAt: null, failReason: null });

/** Jalankan satu langkah. `wrongKey` mensimulasikan kunci privat yang tidak cocok (gagal di langkah kunci). */
export function stepRestore(s: RestoreState, wrongKey: boolean): RestoreState {
  if (s.failedAt !== null || s.next >= RESTORE_STEPS.length) return s;
  const step = RESTORE_STEPS[s.next];
  if (!step) return s;
  if (wrongKey && step.id === 'kunci') {
    return {
      ...s,
      minutes: s.minutes + step.minutes,
      failedAt: s.next,
      failReason:
        'Kunci privat tidak cocok dengan id kunci di manifest. Berhenti sebelum ada plaintext, kontainer, atau berkas yang ditimpa.',
    };
  }
  return { ...s, next: s.next + 1, minutes: s.minutes + step.minutes };
}

export const restorePassed = (s: RestoreState) => s.failedAt === null && s.next >= RESTORE_STEPS.length;

export const RTO_TARGET_MINUTES = 240;
