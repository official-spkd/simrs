import { newId } from '@simrs/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Pakai `X-Request-Id` dari klien bila wajar, selain itu bangkitkan UUID v7. Dipakai pino-http `genReqId`. */
export function genRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : newId();
  res.setHeader('X-Request-Id', id);
  return id;
}
