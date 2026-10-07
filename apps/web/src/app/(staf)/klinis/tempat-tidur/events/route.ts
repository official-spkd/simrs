import { proxyStaffStream } from '@/lib/server/staff-sse';

/**
 * K05 · BFF aliran SSE papan bed (layar W3, ADR-0104): `/api/v1/adt/beds/events` dengan token sesi dari cookie
 * httpOnly. Izin `bed.read` + lingkup unit + audit berlangganan ditegakkan API.
 */

export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  return proxyStaffStream(req, '/api/v1/adt/beds/events');
}
