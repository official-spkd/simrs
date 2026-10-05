import { isoDateJakarta } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import { requestedWeek } from '@/lib/jadwal-api';
import { ApiError } from '@/lib/server/api-core';
import { getWeeklyScheduleApi } from '@/lib/server/data/front-office/jadwal';
import { can, type SessionView } from '@/lib/session-view';
import { JadwalApiClient } from './jadwal-api-client';

/**
 * F01 · Jadwal dokter mode api (fase 2 potongan 2): grid minggu dari API, ubah kuota/cuti untuk `schedule.write`,
 * kirim/tarik HFIS untuk `schedule.sync`. Izin ditegakkan ulang di API.
 */
export async function ApiJadwal({
  session,
  minggu,
  pilih,
}: {
  session: SessionView;
  minggu: string | null;
  pilih: string | null;
}) {
  const today = isoDateJakarta(new Date());
  const weekStart = requestedWeek(minggu, today);
  let schedule;
  try {
    schedule = await getWeeklyScheduleApi(weekStart);
  } catch (err) {
    if (err instanceof ApiError && err.status !== 401) {
      return (
        <Alert level="critical" title="Jadwal tidak bisa dimuat">
          {err.message}
        </Alert>
      );
    }
    throw err;
  }
  return (
    <JadwalApiClient
      key={weekStart}
      schedule={schedule}
      today={today}
      initialSlot={pilih}
      canWrite={can(session, 'schedule', 'write')}
      canSync={can(session, 'schedule', 'sync')}
    />
  );
}
