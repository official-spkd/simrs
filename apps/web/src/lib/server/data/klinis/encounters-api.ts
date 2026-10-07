import 'server-only';
import {
  type EncounterContext,
  encounterContextSchema,
  type WorklistPatient,
  type WorklistTask,
  worklistSchema,
} from '@simrs/shared';
import { api } from '../../api';

/**
 * Data kunjungan bersama layar klinis mode api (W2 CPOE, W5a tablet persetujuan, …). Izin + ABAC + audit per pasien
 * ditegakkan API.
 */

/** Banner pasien + kunjungan (`GET /encounters/:id/context`; `id` sudah divalidasi UUID oleh pemanggil). */
export function getEncounterContextApi(encounterId: string): Promise<EncounterContext> {
  return api(`/api/v1/encounters/${encounterId}/context`, { schema: encounterContextSchema });
}

/**
 * Kunjungan berjalan yang relevan bagi saya dari worklist K01 (`/api/v1/worklist`, izin `clinical.read`): pasien tempat
 * saya DPJP/rawat bersama (`dpjp`) lalu pasien di unit penugasan (`unit`), tanpa duplikat, berikut tugas pribadi saya.
 */
export async function getRunningEncountersApi(): Promise<{
  patients: WorklistPatient[];
  tasks: WorklistTask[];
}> {
  const [mine, unit] = await Promise.all([
    api('/api/v1/worklist?view=dpjp', { schema: worklistSchema }),
    api('/api/v1/worklist?view=unit', { schema: worklistSchema }),
  ]);
  const byId = new Map<string, WorklistPatient>();
  for (const p of [...mine.patients, ...unit.patients]) {
    if (!byId.has(p.encounterId)) byId.set(p.encounterId, p);
  }
  return { patients: [...byId.values()], tasks: mine.tasks };
}
