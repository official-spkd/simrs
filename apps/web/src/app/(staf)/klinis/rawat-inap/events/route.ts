import { cookies, headers } from 'next/headers';
import { clientInfo } from '@/lib/client-info';
import { cookieNames } from '@/lib/server/cookies';
import { webEnv } from '@/lib/server/web-env';

/**
 * K12 · BFF aliran SSE eskalasi EWS untuk layar Rawat inap mode api (ADR-0026, kanal 3.1 `clinical/streams/ews`).
 * Browser tidak pernah memegang token: handler ini membaca token akses staf dari cookie httpOnly lalu meneruskan
 * aliran API apa adanya (tanpa buffer). API menyaring per lingkup sesi (unit penugasan / relasi tim) dan mengaudit
 * langganan; muatan tanpa PHI (ID kunjungan, unit, skor). Klien menutup → permintaan ke API ikut dibatalkan.
 */

export const dynamic = 'force-dynamic';

const LAST_EVENT_ID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request): Promise<Response> {
  const env = webEnv();
  if (env.dataSource !== 'api') return new Response(null, { status: 404 });
  const token = (await cookies()).get(cookieNames(env.secureCookies).access)?.value;
  if (!token) return new Response(null, { status: 401 });

  const upstreamHeaders = new Headers({ accept: 'text/event-stream', authorization: `Bearer ${token}` });
  const lastEventId = req.headers.get('last-event-id');
  if (lastEventId && LAST_EVENT_ID.test(lastEventId)) upstreamHeaders.set('last-event-id', lastEventId);
  const client = clientInfo(await headers());
  if (client.ip) upstreamHeaders.set('x-forwarded-for', client.ip);
  if (client.host) upstreamHeaders.set('x-forwarded-host', client.host);
  if (client.userAgent) upstreamHeaders.set('user-agent', client.userAgent);

  let upstream: Response;
  try {
    upstream = await fetch(new URL('/api/v1/clinical/streams/ews', env.apiBaseUrl), {
      headers: upstreamHeaders,
      cache: 'no-store',
      redirect: 'error',
      signal: req.signal,
    });
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
