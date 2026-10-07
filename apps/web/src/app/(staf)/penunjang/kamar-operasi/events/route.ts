import { SUPPORT_STREAM_PATHS } from '@simrs/shared';
import { proxyStaffStream } from '@/lib/server/staff-sse';

/**
 * S06 · BFF aliran SSE papan kamar operasi (4.7 di atas kanal 4.1a): `/api/v1/support/streams/surgery-board?date=`
 * dengan token sesi dari cookie httpOnly. Izin `surgery.read`, lingkup unit OK/relasi, dan audit berlangganan
 * ditegakkan API. `?tanggal=` yang bukan `YYYY-MM-DD` diabaikan.
 */

export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  const tanggal = new URL(req.url).searchParams.get('tanggal');
  const date = tanggal && /^\d{4}-\d{2}-\d{2}$/.test(tanggal) ? `?date=${tanggal}` : '';
  return proxyStaffStream(req, `/api/v1${SUPPORT_STREAM_PATHS.surgeryBoard}${date}`);
}
