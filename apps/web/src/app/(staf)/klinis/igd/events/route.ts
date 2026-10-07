import { proxyStaffStream } from '@/lib/server/staff-sse';

/**
 * K03 · BFF aliran SSE papan IGD (layar W3, ADR-0104): `/api/v1/triage/board/events` dengan token sesi dari cookie
 * httpOnly. Izin `clinical.read` + lingkup unit + audit berlangganan ditegakkan API.
 */

export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  return proxyStaffStream(req, '/api/v1/triage/board/events');
}
