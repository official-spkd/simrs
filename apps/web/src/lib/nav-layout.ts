import type { NavLayout } from '@simrs/ui';

/**
 * Pilihan tampilan navigasi staf (ADR-0092): dock bawah ala macOS atau sidebar. Disimpan di cookie per peramban agar
 * server merender tampilan yang benar sejak awal (tanpa kedip). Bukan data sensitif; tetap divalidasi.
 */
export const NAV_LAYOUT_COOKIE = 'simrs_nav';

export function parseNavLayout(raw: string | undefined | null): NavLayout | null {
  return raw === 'dock' || raw === 'sidebar' ? raw : null;
}

/** Tulis cookie pilihan tampilan (1 tahun). Hanya dipanggil di peramban. */
export function writeNavLayoutCookie(layout: NavLayout): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${NAV_LAYOUT_COOKIE}=${layout}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
