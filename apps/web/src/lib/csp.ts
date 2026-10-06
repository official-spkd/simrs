/**
 * Content-Security-Policy ber-nonce per permintaan (ADR-0073). Dibangkitkan `proxy.ts` untuk setiap halaman;
 * Next membaca nonce dari header CSP permintaan dan memasangnya di semua skrip kerangkanya (hidrasi, RSC).
 * Skrip: hanya yang membawa nonce permintaan ini (+ yang dimuatnya, `strict-dynamic`); tanpa `unsafe-inline`.
 * Gaya tetap `unsafe-inline` (atribut `style` React dan font Next). `unsafe-eval` + websocket hanya `next dev` (HMR).
 */

/** Header permintaan internal berisi nonce, untuk komponen server yang memasang `<Script nonce>`. */
export const NONCE_HEADER = 'x-nonce';

/** Nonce 128 bit acak (base64), baru untuk setiap permintaan. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(nonce: string, opts: { dev: boolean }): string {
  return [
    "default-src 'self'",
    // `'self'` hanya cadangan peramban CSP2; peramban CSP3 mengabaikannya karena `strict-dynamic`.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${opts.dev ? ' ws: wss:' : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/**
 * Berkas statis yang dilayani route handler (gambar panduan superadmin, termasuk SVG): tanpa skrip sama sekali dan
 * `sandbox` walau dibuka langsung. Proxy menimpa header CSP respons, jadi kebijakan ini dipilih di proxy menurut path
 * (`responsePolicy`), bukan hanya di route handler.
 */
export const STATIC_FILE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox";

const STATIC_FILE_PREFIXES = ['/superadmin/panduan/gambar/'];

/** CSP respons untuk `pathname`: kebijakan berkas statis untuk rute berkas, selain itu kebijakan halaman ber-nonce. */
export function responsePolicy(pathname: string, pagePolicy: string): string {
  return STATIC_FILE_PREFIXES.some((p) => pathname.startsWith(p)) ? STATIC_FILE_CSP : pagePolicy;
}
