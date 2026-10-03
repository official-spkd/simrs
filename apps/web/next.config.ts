import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { NextConfig } from 'next';

/**
 * Next.js hanya membaca .env di folder apps/web. Dari .env root kita ambil daftar putih variabel server saja
 * (bukan NODE_ENV, yang diatur Next sendiri), dan tidak menimpa nilai yang sudah disetel lingkungan.
 */
const ROOT_ENV_ALLOWLIST = ['APP_ENV', 'API_BASE_URL', 'WEB_BASE_URL'] as const;
const rootEnvPath = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnvPath)) {
  const parsed = parseEnv(readFileSync(rootEnvPath, 'utf8'));
  for (const key of ROOT_ENV_ALLOWLIST) {
    if (process.env[key] === undefined && parsed[key] !== undefined) process.env[key] = parsed[key];
  }
}

const isDev = process.env.NODE_ENV === 'development';

/**
 * CSP: hanya sumber dari asal sendiri. `unsafe-inline` untuk skrip dibutuhkan hidrasi Next tanpa nonce
 * (utang teknis: pindah ke CSP ber-nonce saat hardening fase 10). `unsafe-eval` dan websocket hanya di dev (HMR).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Selalu dikirim: header() Next dibakukan saat build, jadi keputusan berbasis env bisa salah di deploy.
  // Browser mengabaikan HSTS yang diterima lewat HTTP biasa (localhost), jadi aman untuk pengembangan.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  transpilePackages: ['@simrs/ui'],
  poweredByHeader: false,
  typedRoutes: false,
  // Panduan superadmin dibaca dari docs/panduan saat runtime; sertakan saat output standalone.
  outputFileTracingIncludes: { '/superadmin/panduan/**': ['../../docs/panduan/**/*.md'] },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
