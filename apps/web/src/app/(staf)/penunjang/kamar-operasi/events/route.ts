import { proxyStaffStream } from '@/lib/server/staff-sse';

/**
 * S06 · BFF aliran SSE aktivitas papan kamar operasi (4.7b, ADR-0106): `/api/v1/surgery/board/events?date=` dengan
 * token sesi dari cookie httpOnly. Setiap perubahan kasus (status, butir tilik, hitung, BHP, laporan, spesimen,
 * formulir anestesi) memicu muat ulang papan. Izin `surgery.read`, lingkup unit OK/relasi, dan audit berlangganan
 * ditegakkan API. `?tanggal=` yang bukan `YYYY-MM-DD` diabaikan.
 */

export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  const tanggal = new URL(req.url).searchParams.get('tanggal');
  const date = tanggal && /^\d{4}-\d{2}-\d{2}$/.test(tanggal) ? `?date=${tanggal}` : '';
  return proxyStaffStream(req, `/api/v1/surgery/board/events${date}`);
}
