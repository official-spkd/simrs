import { formatJam, isoDateJakarta } from '@simrs/shared';
import { formatTglJam } from './rawat-inap';
import { screenById, screenOpen } from './screens';

/**
 * Fase 3 · Bagan rekam medis elektronik per pasien (layar FE2): navigasi antarlayar RME untuk satu kunjungan
 * (`?pasien=<encounterId>`), dan util bersama (jam demo, pencocokan teks). Logika murni, diuji vitest.
 */

/** Layar bagan RME per pasien, urut alur kerja klinisi. Hanya yang terdaftar di `SCREENS` dan terbuka tampil. */
export const RME_CHART_SCREENS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'ringkasan', label: 'Ringkasan' },
  { id: 'cppt', label: 'CPPT & serah terima' },
  { id: 'asesmen', label: 'Asesmen' },
  { id: 'diagnosis', label: 'Diagnosis' },
  { id: 'konsul', label: 'Konsultasi' },
  { id: 'edukasi', label: 'Edukasi' },
  { id: 'askep', label: 'Asuhan keperawatan' },
  { id: 'kelengkapan', label: 'Kelengkapan RM' },
];

export interface ChartLink {
  id: string;
  label: string;
  href: string;
  current: boolean;
}

/** Rute layar + pasien terpilih. */
export function chartHref(route: string, encounterId: string): string {
  return `${route}?pasien=${encodeURIComponent(encounterId)}`;
}

/** Tautan bagan RME yang terbuka untuk posisi ini (mode presentasi), dengan penanda layar aktif. */
export function chartLinks(role: string | null, encounterId: string, currentId: string): ChartLink[] {
  return RME_CHART_SCREENS.flatMap(({ id, label }) => {
    const s = screenById(id);
    if (!s || !screenOpen(s, { dataSource: 'demo', role })) return [];
    return [{ id, label, href: chartHref(s.route, encounterId), current: id === currentId }];
  });
}

/** Rute layar terdaftar dan terbuka untuk posisi ini, null bila tidak. */
export function openRoute(id: string, role: string | null): string | null {
  const s = screenById(id);
  return s && screenOpen(s, { dataSource: 'demo', role }) ? s.route : null;
}

/** Jam saja bila hari yang sama dengan `refIso` (WIB), selain itu "6 Okt · 08.15" (tenggat esok hari tidak ambigu). */
export function shortWhen(iso: string, refIso: string): string {
  return isoDateJakarta(iso) === isoDateJakarta(refIso) ? formatJam(iso) : formatTglJam(iso);
}

/** Teks bebas minimal `min` karakter (alasan koreksi/override/pembatalan; aturan docs/08). */
export function hasReason(text: string | null | undefined, min = 10): boolean {
  return (text ?? '').trim().length >= min;
}

/** Sisa karakter alasan, untuk petunjuk "4 karakter lagi". */
export function reasonShortBy(text: string, min = 10): number {
  return Math.max(min - text.trim().length, 0);
}
