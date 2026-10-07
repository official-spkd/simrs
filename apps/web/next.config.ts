import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { NextConfig } from 'next';
import { normalizeBasePath } from './src/lib/base-path';

/**
 * Next.js hanya membaca .env di folder apps/web. Dari .env root kita ambil daftar putih variabel server saja
 * (bukan NODE_ENV, yang diatur Next sendiri), dan tidak menimpa nilai yang sudah disetel lingkungan.
 */
const ROOT_ENV_ALLOWLIST = [
  'APP_ENV',
  'API_BASE_URL',
  'WEB_BASE_URL',
  'LOGIN_TENANT_CODE',
  'DATA_SOURCE',
  'REDIS_URL',
  'REFRESH_STORE',
  'REFRESH_REDIS_PREFIX',
  // Kunci Server Action bersama antar-instans web (ADR-0073); hanya disalin bila diisi.
  'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
  // Prefiks path saat dipasang di bawah path (mis. demo `/demo-simrs`); dibakukan saat build.
  'WEB_BASE_PATH',
] as const;
const rootEnvPath = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnvPath)) {
  const parsed = parseEnv(readFileSync(rootEnvPath, 'utf8'));
  for (const key of ROOT_ENV_ALLOWLIST) {
    const value = parsed[key];
    if (process.env[key] !== undefined || value === undefined) continue;
    if (key === 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY' && !value.trim()) continue;
    process.env[key] = value;
  }
}

/**
 * Header keamanan statis. Content-Security-Policy TIDAK di sini: nonce-nya berbeda per permintaan, jadi dipasang
 * `src/proxy.ts` (`src/lib/csp.ts`, ADR-0073).
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Selalu dikirim: header() Next dibakukan saat build, jadi keputusan berbasis env bisa salah di deploy.
  // Browser mengabaikan HSTS yang diterima lewat HTTP biasa (localhost), jadi aman untuk pengembangan.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

/** `WEB_BASE_PATH` kosong = akar domain. Diteruskan ke klien sebagai `NEXT_PUBLIC_BASE_PATH` (`src/lib/base-path.ts`). */
const basePath = normalizeBasePath(process.env.WEB_BASE_PATH);

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  transpilePackages: ['@simrs/ui'],
  // Klien Redis peta refresh sesi (proxy, ADR-0073): dimuat dari node_modules, tidak dibundel.
  serverExternalPackages: ['ioredis'],
  poweredByHeader: false,
  typedRoutes: false,
  // Unggah dokumen pasien lewat Server Action (P08, maks. 10 MB per berkas + metadata formulir).
  experimental: { serverActions: { bodySizeLimit: '11mb' } },
  // Hanya `next dev`: izinkan membuka lewat 127.0.0.1 (mis. bila localhost:3000 di IPv6 dipakai aplikasi lain).
  allowedDevOrigins: ['127.0.0.1'],
  // Panduan superadmin (Markdown + gambar) dibaca dari docs/panduan saat runtime; sertakan saat output standalone.
  outputFileTracingIncludes: {
    '/superadmin/panduan/**': ['../../docs/panduan/**/*.md', '../../docs/panduan/gambar/*.{png,svg}'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
