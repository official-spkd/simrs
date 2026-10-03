import type { NextFunction, Request, Response } from 'express';

/** API JSON tidak memuat apa pun: blokir semua sumber, termasuk pembingkaian (clickjacking). */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** Swagger UI (hanya non-produksi) memuat skrip/gaya dari asal yang sama; gaya inline dibutuhkan UI-nya. */
export const DOCS_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

/**
 * Header keamanan untuk setiap respons (padanan helmet tanpa dependensi tambahan).
 * Didaftarkan paling awal di `configureApp` agar juga berlaku untuk rute Swagger dan 404.
 * Respons API ditandai `no-store` agar data pasien tidak tersimpan di cache browser/proxy.
 */
export function securityHeaders(opts: { hsts: boolean }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const isDocs = req.path === '/docs' || req.path.startsWith('/docs/');
    res.setHeader('Content-Security-Policy', isDocs ? DOCS_CSP : API_CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (!isDocs) res.setHeader('Cache-Control', 'no-store');
    if (opts.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
