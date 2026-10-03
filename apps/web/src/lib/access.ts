import { devToolsAllowed } from '@simrs/shared';

export type SuperadminAccess =
  { allowed: true; mode: 'dev-tanpa-login' } | { allowed: false; reason: 'produksi-tanpa-login' };

/**
 * Akses area superadmin platform (panduan sistem, fondasi UI).
 *
 * Fase 0 belum punya login (P02), sehingga area ini hanya dibuka bila APP_ENV eksplisit `local`/`staging`.
 * APP_ENV tidak disetel atau `production` → tertutup (halaman 404, menu tidak tampil).
 * Fase 1: ganti dengan pemeriksaan sesi + peran `superadmin_platform` (lihat ADR-0010).
 * NODE_ENV sengaja tidak dipakai: `next build`/`next start` selalu `production`.
 */
export function superadminAccess(
  env: { APP_ENV?: string | undefined } = { APP_ENV: process.env.APP_ENV },
): SuperadminAccess {
  return devToolsAllowed({ APP_ENV: env.APP_ENV })
    ? { allowed: true, mode: 'dev-tanpa-login' }
    : { allowed: false, reason: 'produksi-tanpa-login' };
}
