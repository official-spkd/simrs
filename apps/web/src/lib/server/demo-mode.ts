import 'server-only';
import { AppError } from '@simrs/shared';
import { webEnv } from './web-env';

/**
 * Gerbang keras mode presentasi (ADR-0023 keputusan 2) tanpa ketergantungan ke sesi, agar modul yang dipakai saat
 * memuat sesi (berkas akun presentasi, Superadmin demo) bisa memakainya tanpa impor melingkar. Diekspor ulang oleh
 * `demo-guard.ts`.
 */
export function assertDemo(): void {
  if (webEnv().dataSource !== 'demo') {
    throw new AppError('FORBIDDEN', 'Mode presentasi tidak aktif', 403);
  }
}
