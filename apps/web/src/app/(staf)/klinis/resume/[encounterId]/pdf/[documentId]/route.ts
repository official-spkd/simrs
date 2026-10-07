import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiDownload } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

const uuid = z.uuid();

/**
 * K13 · Cetak resume: PDF ber-TTE dari API (`GET /api/v1/documents/:id/content`, ABAC + audit `print/read` di API),
 * diteruskan lewat BFF (token tetap di server), dibuka inline di tab baru. Hanya dari halaman sendiri.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ encounterId: string; documentId: string }> },
): Promise<Response> {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return new Response('Cetak harus dimulai dari layar Resume.', { status: 403 });
  }
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') {
    return new Response('Silakan masuk terlebih dahulu.', { status: 401 });
  }
  if (!can(s, 'documents', 'read')) {
    return new Response('Peran Anda tidak berizin membuka dokumen pasien.', { status: 403 });
  }
  const { documentId } = await params;
  const id = uuid.safeParse(documentId);
  if (!id.success) return new Response('Dokumen tidak dikenal.', { status: 404 });
  try {
    const file = await apiDownload(`/api/v1/documents/${id.data}/content`);
    return new Response(file.body, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'inline; filename="resume-medis.pdf"',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    const message = err instanceof ApiError ? err.message : 'Dokumen tidak bisa dibuka.';
    return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}
