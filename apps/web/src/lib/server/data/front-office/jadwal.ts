import 'server-only';
import { type WeeklySchedule, weeklyScheduleSchema } from '@simrs/shared';
import { demoWeeklySchedule } from '../../../demo/fixtures/front-office';
import type { SessionView } from '../../../session-view';
import { api } from '../../api';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';
import { demoProgress } from './shared';

/**
 * F01 · Data layar Jadwal dokter. Mode presentasi: data dummy (minggu demo tetap); mode api: `GET
 * /api/v1/scheduling/week` (grid minggu + perbedaan HFIS dari tarikan terakhir).
 */

export async function getWeeklySchedule(session: SessionView): Promise<WeeklySchedule> {
  if (webEnv().dataSource === 'demo') {
    return weeklyScheduleSchema.parse(demoWeeklySchedule(await demoProgress(session)));
  }
  return notImplemented('jadwal dokter (pakai getWeeklyScheduleApi)');
}

/** Mode api: grid minggu mulai Senin `weekStart` (`YYYY-MM-DD`, sudah divalidasi pemanggil). */
export function getWeeklyScheduleApi(weekStart: string): Promise<WeeklySchedule> {
  return api(`/api/v1/scheduling/week?weekStart=${encodeURIComponent(weekStart)}`, {
    schema: weeklyScheduleSchema,
  });
}
