import 'server-only';
import type { EncounterContext, WorklistPatient } from '@simrs/shared';
import { z } from 'zod';
import { ApiError } from '../../api-core';
import { getEncounterContextApi, getRunningEncountersApi } from './encounters-api';

/**
 * Bagan RME mode api (fase 3 · layar klinis FE2): satu pola untuk layar per kunjungan (`?kunjungan=<id>`): tanpa
 * kunjungan → daftar kunjungan berjalan (worklist K01: pasien saya + unit saya); kunjungan → banner dari
 * `/encounters/:id/context` (ABAC + audit di API); 404/403 menjadi keadaan halaman, bukan galat.
 */
export type EncounterResolution =
  | { kind: 'pick'; patients: WorklistPatient[] }
  | { kind: 'not-found' }
  | { kind: 'denied'; message: string }
  | { kind: 'ok'; context: EncounterContext };

export async function resolveEncounter(raw: string | string[] | undefined): Promise<EncounterResolution> {
  const id = z.uuid().safeParse(raw);
  if (!id.success) {
    if (raw !== undefined) return { kind: 'not-found' };
    try {
      return { kind: 'pick', patients: (await getRunningEncountersApi()).patients };
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) return { kind: 'denied', message: err.message };
      throw err;
    }
  }
  try {
    return { kind: 'ok', context: await getEncounterContextApi(id.data) };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return { kind: 'not-found' };
    if (err instanceof ApiError && err.status === 403) return { kind: 'denied', message: err.message };
    throw err;
  }
}
