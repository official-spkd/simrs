import { DOCUMENT_TYPES } from '@simrs/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiDownload } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { can, nextLoginStep } from '@/lib/session-view';

const EXT: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(DOCUMENT_TYPES).map(([mime, t]) => [mime, t.ext]),
);

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/**
 * P08 · Unduh berkas dokumen pasien dari layar klinis (fase 3 · 3.8): diteruskan dari API lewat BFF (token tetap di
 * server; hash berkas dicek API, pembukaan diaudit API). Selalu sebagai lampiran, tidak dirender di halaman.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  // Tautan dari situs lain tidak boleh memicu unduhan + entri audit atas nama pengguna (cookie SameSite=Lax).
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    return text('Unduhan harus dimulai dari layar SIM RS.', 403);
  if (webEnv().dataSource !== 'api') return text('Unduhan dokumen hanya tersedia di mode api.', 404);
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') return text('Silakan masuk terlebih dahulu.', 401);
  if (!can(s, 'documents', 'read')) return text('Peran Anda tidak berizin membuka dokumen pasien.', 403);
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return text('Dokumen tidak ditemukan.', 404);
  try {
    const file = await apiDownload(`/api/v1/documents/${id.data}/content`);
    const ext = EXT[file.contentType] ?? 'bin';
    return new Response(file.body, {
      headers: {
        'content-type': file.contentType,
        'content-disposition': `attachment; filename="dokumen-${id.data}.${ext}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        // Berkas dari luar (PDF/gambar unggahan) tidak pernah dijalankan sebagai halaman aplikasi.
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    return text(err instanceof ApiError ? err.message : 'Unduhan gagal.', status);
  }
}
