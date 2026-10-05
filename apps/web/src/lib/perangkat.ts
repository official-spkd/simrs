import { DEVICE_HOME, type DevicePrincipalKind } from '@simrs/shared';
import { safeNextPath } from './safe-path';

/**
 * Layar perangkat (ADR-0027) di web: anjungan (`/kiosk`) dan display TV (`/display/…`). Di mode api, layar ini
 * dibuka oleh PERANGKAT terdaftar (cookie `simrs_device`), bukan sesi staf; mode presentasi tetap di balik login staf.
 * Modul murni (dipakai proxy dan Server Component).
 */
export const DEVICE_SCREEN_ROUTES: Readonly<Record<DevicePrincipalKind, string>> = {
  kiosk: '/kiosk',
  display: '/display',
};

/** Halaman pendaftaran perangkat (publik, tanpa login staf). */
export const ENROL_PATH = '/perangkat/daftar';

/** Jenis perangkat pemilik path ini, atau null bila bukan layar perangkat. */
export function deviceRouteKind(pathname: string): DevicePrincipalKind | null {
  for (const [kind, prefix] of Object.entries(DEVICE_SCREEN_ROUTES) as Array<[DevicePrincipalKind, string]>) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return kind;
  }
  return null;
}

/** URL pendaftaran perangkat dengan tujuan sesudahnya (hanya layar perangkat; selain itu halaman awal jenisnya). */
export function enrolUrl(next?: string | null): string {
  const target = safeNextPath(next ?? null, '');
  const path = target.split('?')[0] ?? '';
  return target && deviceRouteKind(path) ? `${ENROL_PATH}?lanjut=${encodeURIComponent(target)}` : ENROL_PATH;
}

/** Tujuan setelah perangkat terdaftar: `lanjut` bila layar milik jenis yang sama, selain itu halaman awal jenisnya. */
export function deviceLanding(kind: DevicePrincipalKind, next?: string | null): string {
  const target = safeNextPath(next ?? null, '');
  return target && deviceRouteKind(target.split('?')[0] ?? '') === kind ? target : DEVICE_HOME[kind];
}
