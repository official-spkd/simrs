import 'server-only';
import { type QueueBoard, queueBoardSchema } from '@simrs/shared';
import { demoQueueBoard } from '../../../demo/fixtures/front-office';
import type { SessionView } from '../../../session-view';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';
import { demoProgress } from './shared';

/** F04 · Data papan antrean (display TV). Mode presentasi: data dummy; mode api: menunggu fase 2 potongan 4b. */

export async function getQueueBoard(session: SessionView): Promise<QueueBoard> {
  if (webEnv().dataSource === 'demo') {
    return queueBoardSchema.parse(demoQueueBoard(await demoProgress(session)));
  }
  return notImplemented('papan antrean');
}
