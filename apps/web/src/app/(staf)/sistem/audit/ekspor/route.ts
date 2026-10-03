import { AUDIT_ACTION_GROUPS } from '@simrs/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { RENTANG, rangeStart, tanggalWib } from '@/lib/audit';
import { apiDownload } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

const querySchema = z.object({
  rentang: z.enum(Object.keys(RENTANG) as [keyof typeof RENTANG]).catch('30-hari'),
  jenis: z
    .enum(Object.keys(AUDIT_ACTION_GROUPS) as [keyof typeof AUDIT_ACTION_GROUPS])
    .optional()
    .catch(undefined),
  peran: z
    .string()
    .regex(/^[a-z][a-z0-9_]{2,40}$/)
    .optional()
    .catch(undefined),
  pasien: z.uuid().optional().catch(undefined),
  pengguna: z.uuid().optional().catch(undefined),
});

/**
 * "Unduh paket bukti akreditasi": CSV jejak audit sesuai filter layar, diteruskan dari API lewat BFF (token tetap
 * di server). Butuh izin `audit.export`; ekspor dicatat di jejak audit oleh API.
 */
export async function GET(req: NextRequest): Promise<Response> {
  // Cookie SameSite=Lax ikut terkirim pada navigasi GET dari situs lain: tautan dari luar tidak boleh memicu
  // ekspor (berkas terunduh + entri audit atas nama pengguna). Hanya dari halaman sendiri atau dibuka langsung.
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    return new Response('Unduhan harus dimulai dari layar Audit.', { status: 403 });

  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai')
    return new Response('Silakan masuk terlebih dahulu.', { status: 401 });
  if (!can(s, 'audit', 'export'))
    return new Response('Peran Anda tidak berizin mengekspor jejak audit.', { status: 403 });

  const q = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const to = new Date();
  const from = rangeStart(q.rentang, to);
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: new Date(to.getTime() + 1000).toISOString(),
  });
  if (q.jenis) params.set('group', q.jenis);
  if (q.peran) params.set('actorRole', q.peran);
  if (q.pasien) params.set('patientId', q.pasien);
  if (q.pengguna) params.set('actorUserId', q.pengguna);

  try {
    const file = await apiDownload(`/api/v1/audit/export?${params.toString()}`);
    return new Response(file.body, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="jejak-audit-${s.tenant.code}-${tanggalWib(to)}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    const message = err instanceof ApiError ? err.message : 'Ekspor gagal.';
    return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}
