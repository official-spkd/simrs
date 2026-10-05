import { headers } from 'next/headers';
import { clientInfo } from '@/lib/client-info';
import { deviceToken } from '@/lib/server/data/front-office/antrean';
import { getDevice } from '@/lib/server/device';
import { webEnv } from '@/lib/server/web-env';

/**
 * F04 · BFF aliran SSE papan antrean TV (ADR-0026, fase 2 potongan 4b). Browser TV tidak pernah memegang token:
 * handler ini membaca token perangkat dari cookie httpOnly, memastikan perangkatnya display yang terikat ke papan,
 * lalu meneruskan aliran `/api/v1/queue/displays/:id/events` apa adanya (tanpa buffer, `X-Accel-Buffering: no`).
 * `Last-Event-ID` dari sambung ulang otomatis `EventSource` diteruskan agar API memutar ulang panggilan yang
 * terlewat (atau mengirim `reset`). Klien menutup → permintaan ke API ikut dibatalkan.
 */

export const dynamic = 'force-dynamic';

const LAST_EVENT_ID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request): Promise<Response> {
  const env = webEnv();
  if (env.dataSource !== 'api') return new Response(null, { status: 404 });
  const device = await getDevice();
  const token = await deviceToken();
  if (!device || !token) return new Response(null, { status: 401 });
  if (device.kind !== 'queue_display' || !device.queueDisplay) return new Response(null, { status: 409 });

  const upstreamHeaders = new Headers({ accept: 'text/event-stream', authorization: `Bearer ${token}` });
  const lastEventId = req.headers.get('last-event-id');
  if (lastEventId && LAST_EVENT_ID.test(lastEventId)) upstreamHeaders.set('last-event-id', lastEventId);
  const client = clientInfo(await headers());
  if (client.ip) upstreamHeaders.set('x-forwarded-for', client.ip);
  if (client.host) upstreamHeaders.set('x-forwarded-host', client.host);
  if (client.userAgent) upstreamHeaders.set('user-agent', client.userAgent);

  let upstream: Response;
  try {
    upstream = await fetch(
      new URL(`/api/v1/queue/displays/${device.queueDisplay.id}/events`, env.apiBaseUrl),
      { headers: upstreamHeaders, cache: 'no-store', redirect: 'error', signal: req.signal },
    );
  } catch {
    return new Response(null, { status: 503 });
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    return new Response(null, {
      status: upstream.status === 401 || upstream.status === 403 ? upstream.status : 502,
    });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
