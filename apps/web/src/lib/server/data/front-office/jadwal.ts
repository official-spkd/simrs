import 'server-only';
import { type WeeklySchedule, weeklyScheduleSchema } from '@simrs/shared';
import { demoWeeklySchedule } from '../../../demo/fixtures/front-office';
import type { SessionView } from '../../../session-view';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';
import { demoProgress } from './shared';

/** F01 · Data layar Jadwal dokter. Mode presentasi: data dummy; mode api: menunggu fase 2 potongan 2. */

export async function getWeeklySchedule(session: SessionView): Promise<WeeklySchedule> {
  if (webEnv().dataSource === 'demo') {
    return weeklyScheduleSchema.parse(demoWeeklySchedule(await demoProgress(session)));
  }
  return notImplemented('jadwal dokter');
}
