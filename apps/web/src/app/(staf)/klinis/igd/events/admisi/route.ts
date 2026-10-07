import { proxyStaffStream } from '@/lib/server/staff-sse';

/**
 * K03 · BFF aliran SSE papan IGD administratif (loket pendaftaran IGD, ADR-0109):
 * `/api/v1/triage/board/admission/events`. Izin `encounter.read` + lingkup + audit berlangganan ditegakkan API.
 */

export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  return proxyStaffStream(req, '/api/v1/triage/board/admission/events');
}
