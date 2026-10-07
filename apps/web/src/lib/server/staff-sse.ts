import 'server-only';
import { cookies, headers } from 'next/headers';
import { clientInfo } from '../client-info';
import { cookieNames } from './cookies';
import { webEnv } from './web-env';

const LAST_EVENT_ID = /^[0-9a-f-]{36}$/i;

/**
 * BFF aliran SSE staf (ADR-0026, ADR-0104): browser tidak pernah memegang token. Route handler membaca cookie akses
 * httpOnly sesi (proxy sudah memperpanjangnya bila habis), lalu meneruskan aliran API `apiPath` apa adanya tanpa buffer
 * (`X-Accel-Buffering: no`). `Last-Event-ID` sambung ulang diteruskan; klien menutup → permintaan ke API ikut batal.
 * Izin dan audit berlangganan ditegakkan API (`@RequirePermission` + `@Audited` di endpoint aliran).
 * `apiPath` selalu konstanta kode kita sendiri, tidak pernah dari input.
 */
export async function proxyStaffStream(req: Request, apiPath: string): Promise<Response> {
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
    upstream = await fetch(new URL(apiPath, env.apiBaseUrl), {
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
