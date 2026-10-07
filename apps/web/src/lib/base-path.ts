/**
 * Prefiks path web saat SIM RS dipasang di bawah path, bukan di akar domain (mis. demo `demo.spkd.store/demo-simrs`).
 * Diisi saat build dari `WEB_BASE_PATH` (next.config.ts → `basePath` + `NEXT_PUBLIC_BASE_PATH`); kosong = akar domain.
 *
 * `next/link`, `redirect()` dan `router.push()` sudah menambahkan prefiks sendiri. Helper ini hanya untuk URL yang
 * Next tidak sentuh: `<a href>`, `<img src>`, `<form action>` biasa, `EventSource`, dan `new URL(...)` di proxy.
 */
export const BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

/** `''` atau `/segmen[/segmen…]` (huruf kecil, angka, strip); nilai lain ditolak agar build gagal lebih awal. */
export function normalizeBasePath(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (value === '') return '';
  if (!/^(\/[a-z0-9][a-z0-9-]*)+$/.test(value)) {
    throw new Error(`WEB_BASE_PATH tidak sah: "${raw}" (contoh: /demo-simrs, atau kosong untuk akar domain)`);
  }
  return value;
}

/** Tambahkan prefiks ke path internal absolut (`/…`); URL lain (`#…`, `https://…`, relatif) dikembalikan apa adanya. */
export function withBasePath(path: string, basePath: string = BASE_PATH): string {
  if (!basePath || !path.startsWith('/') || path.startsWith('//')) return path;
  return `${basePath}${path}`;
}
