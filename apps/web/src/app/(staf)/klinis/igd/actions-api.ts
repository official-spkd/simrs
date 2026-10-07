'use server';

import {
  BED_STATUSES,
  bedRequestInputSchema,
  bedStatusChangeInputSchema,
  ED_STATUSES,
  ED_ZONES,
  edStatusInputSchema,
  emergencyRegistrationSchema,
  emergencySepInputSchema,
  registrationResultSchema,
  TRIAGE_DISCRIMINATOR_CODES,
  triageAssessmentRecordSchema,
  triageLevelSchema,
  triageSuggestionInputSchema,
  type TriageSuggestionApi,
  triageSuggestionSchema,
  triageVitalsSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { type ApiActionResult, attempt, authorizeApi } from '@/lib/server/klinis-api-action';

/**
 * K03 · Server Action layar IGD mode api (layar W3). Satu-satunya jalan klien ke API: izin diperiksa di sini (pesan
 * jelas), ditegakkan ulang API (izin + lingkup unit + gerbang triase). Papan diperbarui lewat SSE (`./events`) dan
 * `router.refresh()` klien sesudah aksi; tidak ada data pasien di URL.
 */

const uuid = z.uuid();
const issue = (e: z.ZodError) => e.issues[0]?.message ?? 'Isian tidak valid.';

/** Pendaftaran IGD (pasien MPI atau tanpa identitas). `key` = Idempotency-Key per isian (klik ganda → hasil sama). */
export async function registerEmergencyAction(
  input: unknown,
  key: unknown,
): Promise<ApiActionResult<{ encounterId: string; number: string }>> {
  const auth = await authorizeApi('encounter.write', 'Peran Anda tidak berizin mendaftarkan pasien IGD.');
  if (!auth.ok) return auth;
  const p = emergencyRegistrationSchema.safeParse(input);
  const k = uuid.safeParse(key);
  if (!p.success) return { ok: false, message: issue(p.error) };
  if (!k.success) return { ok: false, message: 'Kunci permintaan tidak sah; muat ulang halaman.' };
  return attempt(async () => {
    const r = await api('/api/v1/registration/emergency', {
      method: 'POST',
      body: p.data,
      idempotencyKey: k.data,
      schema: registrationResultSchema,
    });
    return { encounterId: r.encounter.id, number: r.encounter.number };
  });
}

/** Pratinjau saran triase dari server (tanpa menyimpan). */
export async function suggestTriageAction(input: unknown): Promise<ApiActionResult<TriageSuggestionApi>> {
  const auth = await authorizeApi('triage.write', 'Peran Anda tidak berizin menilai triase.');
  if (!auth.ok) return auth;
  const p = triageSuggestionInputSchema.safeParse(input);
  if (!p.success) return { ok: false, message: issue(p.error) };
  return attempt(() =>
    api('/api/v1/triage/suggestions', { method: 'POST', body: p.data, schema: triageSuggestionSchema }),
  );
}

const triageInput = z.strictObject({
  encounterId: uuid,
  vitals: triageVitalsSchema,
  discriminators: z.array(z.enum(TRIAGE_DISCRIMINATOR_CODES)).max(6),
  chosenLevel: triageLevelSchema,
  overrideReason: z.string().trim().max(500).nullable(),
});

/**
 * Simpan triase. Saran + batas protokol dihitung ulang server; level di bawah saran tanpa alasan → 422
 * `TRIAGE_REASON_REQUIRED` (pesan diteruskan). Triase ulang = asesmen baru (versi lama tetap di riwayat).
 */
export async function saveTriageAction(input: unknown): Promise<ApiActionResult<{ level: number }>> {
  const auth = await authorizeApi('triage.write', 'Peran Anda tidak berizin menyimpan triase.');
  if (!auth.ok) return auth;
  const p = triageInput.safeParse(input);
  if (!p.success) return { ok: false, message: issue(p.error) };
  return attempt(async () => {
    const r = await api('/api/v1/triage/assessments', {
      method: 'POST',
      body: { ...p.data, occurredAt: new Date().toISOString(), revision: { kind: 'baru' } },
      schema: triageAssessmentRecordSchema,
    });
    return { level: r.chosenLevel };
  });
}

/** Status alur + zona + bed IGD. */
export async function setEdStatusAction(
  encounterId: unknown,
  input: unknown,
): Promise<ApiActionResult<{ status: string }>> {
  const auth = await authorizeApi('triage.write', 'Peran Anda tidak berizin mengubah status IGD.');
  if (!auth.ok) return auth;
  const id = uuid.safeParse(encounterId);
  const p = edStatusInputSchema.safeParse(input);
  if (!id.success || !p.success)
    return { ok: false, message: p.error ? issue(p.error) : 'Kunjungan tidak sah.' };
  return attempt(async () => {
    const r = await api(`/api/v1/encounters/${id.data}/ed-status`, {
      method: 'POST',
      body: p.data,
      schema: z.object({ status: z.enum(ED_STATUSES), zone: z.enum(ED_ZONES).nullable() }),
    });
    return { status: r.status };
  });
}

/** Keputusan rawat inap: permintaan bed ke papan tempat tidur (`bed.write`). */
export async function requestBedAction(input: unknown): Promise<ApiActionResult<{ id: string }>> {
  const auth = await authorizeApi('bed.write', 'Peran Anda tidak berizin meminta bed rawat inap.');
  if (!auth.ok) return auth;
  const p = bedRequestInputSchema.safeParse(input);
  if (!p.success) return { ok: false, message: issue(p.error) };
  return attempt(() =>
    api('/api/v1/adt/bed-requests', { method: 'POST', body: p.data, schema: z.object({ id: uuid }) }),
  );
}

/** SEP IGD menyusul (diagnosa awal dokter jaga). */
export async function emergencySepAction(
  encounterId: unknown,
  input: unknown,
): Promise<ApiActionResult<{ sepId: string }>> {
  const auth = await authorizeApi('coverage.write', 'Peran Anda tidak berizin membuat SEP.');
  if (!auth.ok) return auth;
  const id = uuid.safeParse(encounterId);
  const p = emergencySepInputSchema.safeParse(input);
  if (!id.success || !p.success)
    return { ok: false, message: p.error ? issue(p.error) : 'Kunjungan tidak sah.' };
  return attempt(() =>
    api(`/api/v1/encounters/${id.data}/emergency-sep`, {
      method: 'POST',
      body: p.data,
      schema: z.object({ sepId: uuid }),
    }),
  );
}

/** Status bed IGD manual (kotor → dibersihkan → siap, rusak) dengan versi yang dilihat petugas. */
export async function changeIgdBedStatusAction(
  bedId: unknown,
  input: unknown,
): Promise<ApiActionResult<{ status: string; version: number }>> {
  const auth = await authorizeApi('bed.write', 'Peran Anda tidak berizin mengubah status bed.');
  if (!auth.ok) return auth;
  const id = uuid.safeParse(bedId);
  const p = bedStatusChangeInputSchema.safeParse(input);
  if (!id.success || !p.success) return { ok: false, message: p.error ? issue(p.error) : 'Bed tidak sah.' };
  return attempt(() =>
    api(`/api/v1/adt/beds/${id.data}/status`, {
      method: 'PATCH',
      body: p.data,
      schema: z.object({ status: z.enum(BED_STATUSES), version: z.int() }),
    }),
  );
}
