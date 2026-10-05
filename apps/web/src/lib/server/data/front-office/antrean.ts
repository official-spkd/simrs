import 'server-only';
import {
  type QueueBoard,
  queueBoardSchema,
  type QueueService,
  queueServiceSchema,
  type QueueTicket,
  queueTicketSchema,
} from '@simrs/shared';
import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { clientInfo } from '../../../client-info';
import { demoQueueBoard } from '../../../demo/fixtures/front-office';
import type { SessionView } from '../../../session-view';
import { api } from '../../api';
import { callApi } from '../../api-core';
import { cookieNames, parseDeviceToken } from '../../cookies';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';
import { demoProgress } from './shared';

/**
 * F04 · Data antrean. Mode presentasi: papan dummy (`getQueueBoard`). Mode api: papan TV dibaca PERANGKAT display
 * (token perangkat dari cookie httpOnly, ADR-0027) dan layanan/tiket untuk staf Kendali antrean (`queue.read`).
 */

export async function getQueueBoard(session: SessionView): Promise<QueueBoard> {
  if (webEnv().dataSource === 'demo') {
    return queueBoardSchema.parse(demoQueueBoard(await demoProgress(session)));
  }
  return notImplemented('papan antrean (pakai getDisplayBoard)');
}

/** Token perangkat dari cookie httpOnly (hanya dibaca server); null bila tidak ada. */
export async function deviceToken(): Promise<string | null> {
  const env = webEnv();
  return parseDeviceToken((await cookies()).get(cookieNames(env.secureCookies).device)?.value);
}

/** Mode api: potret papan display milik perangkat TV ini (`/queue/displays/:id/board`). */
export async function getDisplayBoard(displayId: string): Promise<QueueBoard> {
  const env = webEnv();
  return callApi(env.apiBaseUrl, `/api/v1/queue/displays/${encodeURIComponent(displayId)}/board`, {
    schema: queueBoardSchema,
    accessToken: await deviceToken(),
    client: clientInfo(await headers()),
  });
}

/** Mode api (staf): layanan antrean aktif RS. */
export function getQueueServices(): Promise<QueueService[]> {
  return api('/api/v1/queue/services', { schema: z.array(queueServiceSchema) });
}

/** Mode api (staf): tiket hari ini satu layanan (`serviceId` sudah divalidasi UUID oleh pemanggil). */
export function getQueueTickets(serviceId: string): Promise<QueueTicket[]> {
  return api(`/api/v1/queue/services/${serviceId}/tickets`, { schema: z.array(queueTicketSchema) });
}
