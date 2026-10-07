import 'server-only';
import {
  type CareSetting,
  type CarePackageItem,
  carePackageItemSchema,
  type CareTeamMember,
  careTeamMemberSchema,
  type ConsultInboxItem,
  consultInboxItemSchema,
  type ConsultRequestRecord,
  consultRequestRecordSchema,
  type EncounterCompleteness,
  encounterCompletenessSchema,
  type EncounterContext,
  encounterContextSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { api } from '../../api';
import { ApiError } from '../../api-core';

/**
 * K10 · K15 · Data layar Konsultasi dan Paket layanan mode api, dan bagian 3.8 tab "Dokumen & konsultasi" Rawat inap
 * (fase 3 · 3.8, ADR-0059). Satu pintu ke API: izin + ABAC + audit ditegakkan API; bacaan pelengkap yang 403/404
 * (izin atau modul RS mati) menjadi `null`, bukan galat halaman.
 */

const enc = (id: string) => `/api/v1/encounters/${z.uuid().parse(id)}`;

export async function optional<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return null;
    throw err;
  }
}

export function consultInbox(): Promise<ConsultInboxItem[]> {
  return api('/api/v1/consults/inbox', { schema: consultInboxItemSchema.array() });
}

export function encounterConsults(encounterId: string): Promise<ConsultRequestRecord[]> {
  return api(`${enc(encounterId)}/consults`, { schema: consultRequestRecordSchema.array() });
}

export function careTeam(encounterId: string): Promise<CareTeamMember[]> {
  return api(`${enc(encounterId)}/care-team`, { schema: careTeamMemberSchema.array() });
}

export function completeness(encounterId: string): Promise<EncounterCompleteness> {
  return api(`${enc(encounterId)}/completeness`, { schema: encounterCompletenessSchema });
}

export function encounterContext(encounterId: string): Promise<EncounterContext> {
  return api(`${enc(encounterId)}/context`, { schema: encounterContextSchema });
}

export function carePackages(setting: CareSetting): Promise<CarePackageItem[]> {
  return api(`/api/v1/care-packages?setting=${setting}`, { schema: carePackageItemSchema.array() });
}

/** Formulir P07 yang sudah terbit (pilihan butir paket). */
const formListSchema = z.array(
  z.object({ code: z.string(), title: z.string(), published: z.object({ version: z.int() }).nullable() }),
);
export async function publishedForms(): Promise<Array<{ code: string; title: string }>> {
  const rows = await api('/api/v1/forms', { schema: formListSchema });
  return rows.filter((r) => r.published).map((r) => ({ code: r.code, title: r.title }));
}
