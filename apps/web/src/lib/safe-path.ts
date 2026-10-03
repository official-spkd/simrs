const BASE = 'http://simrs.invalid';

// eslint-disable-next-line no-control-regex -- sengaja menolak karakter kendali dan backslash
const UNSAFE_CHARS = /[\\\u0000-\u001f\u007f]/;

/**
 * Jalur internal yang aman untuk dialihkan setelah login (cegah open redirect): harus path relatif satu
 * garis miring, tanpa skema/host, tanpa backslash atau karakter kendali (mentah maupun di-encode seperti
 * %0d%0a/%5c), dan bukan halaman masuk itu sendiri.
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || raw.length > 512 || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
  if (UNSAFE_CHARS.test(raw)) return fallback;
  let url: URL;
  let decodedPath: string;
  try {
    url = new URL(raw, BASE);
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE || UNSAFE_CHARS.test(decodedPath)) return fallback;
  if (url.pathname === '/masuk' || url.pathname.startsWith('/masuk/')) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** URL halaman masuk dengan tujuan sesudahnya (dan alasan opsional, mis. sesi berakhir). */
export function loginUrl(next: string, reason?: 'sesi-berakhir'): string {
  const params = new URLSearchParams();
  const target = safeNextPath(next);
  if (target !== '/') params.set('lanjut', target);
  if (reason) params.set('alasan', reason);
  const qs = params.toString();
  return qs ? `/masuk?${qs}` : '/masuk';
}
