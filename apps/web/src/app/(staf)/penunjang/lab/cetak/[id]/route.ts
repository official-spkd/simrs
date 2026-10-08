import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiDownload } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { can, nextLoginStep } from '@/lib/session-view';

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/**
 * S01 · Cetak hasil lab (HTML dari API, ber-watermark pencetak; audit `print` di API). Diteruskan BFF (token tetap di
 * server). Halaman cetak disajikan dengan CSP ketat + sandbox: tanpa skrip, tanpa sumber luar.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  // Tautan dari situs lain tidak boleh memicu entri audit cetak atas nama pengguna.
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    return text('Cetak harus dimulai dari layar SIM RS.', 403);
  if (webEnv().dataSource !== 'api') return text('Cetak hasil hanya tersedia di mode api.', 404);
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') return text('Silakan masuk terlebih dahulu.', 401);
  if (!can(s, 'lab.worklist', 'read')) return text('Peran Anda tidak berizin mencetak hasil lab.', 403);
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return text('Order lab tidak ditemukan.', 404);
  try {
    const file = await apiDownload(`/api/v1/lab/orders/${id.data}/print`);
    return new Response(file.body, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox allow-modals",
      },
    });
  } catch (err) {
    if (err instanceof ApiError) return text(err.message, err.status);
    return text('Cetak gagal. Coba lagi.', 500);
  }
}
