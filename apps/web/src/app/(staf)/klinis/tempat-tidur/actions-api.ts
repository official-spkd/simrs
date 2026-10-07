'use server';

import {
  admissionResultApiSchema,
  admitInputSchema,
  BED_STATUSES,
  bedAllocateInputSchema,
  bedRequestCancelInputSchema,
  bedStatusChangeInputSchema,
  dischargeInputSchema,
  type EmergencyAdmissionResult,
  emergencyAdmissionInputSchema,
  emergencyAdmissionResultSchema,
  transferInputSchema,
  wristbandPrintSchema,
  wristbandReprintInputSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { type ApiActionResult, attempt, authorizeApi } from '@/lib/server/klinis-api-action';

/**
 * K04/K05 · Server Action layar Tempat tidur mode api (layar W3): status bed berversi, alokasi/batal permintaan,
 * admisi (dari IGD satu langkah, atau admisi terencana), transfer, pulang (lewat `DischargeGate` API), cetak ulang
 * gelang. Izin diperiksa di sini, ditegakkan ulang API (lingkup unit, konflik versi 409, bed tidak tersedia 409).
 */

const uuid = z.uuid();
const issue = (e: z.ZodError) => e.issues[0]?.message ?? 'Isian tidak valid.';
const BED_DENIED = 'Peran Anda tidak berizin mengubah tempat tidur.';

export async function changeBedStatusAction(
  bedId: unknown,
  input: unknown,
): Promise<ApiActionResult<{ status: string; version: number }>> {
  const auth = await authorizeApi('bed.write', BED_DENIED);
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

export async function allocateBedAction(
  requestId: unknown,
  input: unknown,
): Promise<ApiActionResult<{ bedId: string }>> {
  const auth = await authorizeApi('bed.write', BED_DENIED);
  if (!auth.ok) return auth;
  const id = uuid.safeParse(requestId);
  const p = bedAllocateInputSchema.safeParse(input);
  if (!id.success || !p.success) return { ok: false, message: 'Pilih bed yang akan dialokasikan.' };
  return attempt(() =>
    api(`/api/v1/adt/bed-requests/${id.data}/allocate`, {
      method: 'POST',
      body: p.data,
      schema: z.object({ bedId: uuid }),
    }),
  );
}

export async function cancelBedRequestAction(
  requestId: unknown,
  input: unknown,
): Promise<ApiActionResult<{ id: string }>> {
  const auth = await authorizeApi('bed.write', BED_DENIED);
  if (!auth.ok) return auth;
  const id = uuid.safeParse(requestId);
  const p = bedRequestCancelInputSchema.safeParse(input);
  if (!id.success || !p.success)
    return { ok: false, message: p.error ? issue(p.error) : 'Permintaan tidak sah.' };
  return attempt(() =>
    api(`/api/v1/adt/bed-requests/${id.data}/cancel`, {
      method: 'POST',
      body: p.data,
      schema: z.object({ id: uuid }),
    }),
  );
}

/** Admisi dari IGD satu langkah (admisi rawat inap + masuk bed + gelang). `key` = Idempotency-Key per isian. */
export async function emergencyAdmitAction(
  input: unknown,
  key: unknown,
): Promise<ApiActionResult<EmergencyAdmissionResult>> {
  const auth = await authorizeApi('encounter.write', 'Peran Anda tidak berizin melakukan admisi rawat inap.');
  if (!auth.ok) return auth;
  const p = emergencyAdmissionInputSchema.safeParse(input);
  const k = uuid.safeParse(key);
  if (!p.success) return { ok: false, message: issue(p.error) };
  if (!k.success) return { ok: false, message: 'Kunci permintaan tidak sah; muat ulang halaman.' };
  return attempt(() =>
    api('/api/v1/registration/emergency-admissions', {
      method: 'POST',
      body: p.data,
      idempotencyKey: k.data,
      schema: emergencyAdmissionResultSchema,
    }),
  );
}

/** Admisi terencana (`planned`, mis. SPRI) masuk bed yang sudah dipesan untuknya. */
export async function admitPlannedAction(
  input: unknown,
): Promise<ApiActionResult<{ encounterId: string; wristbandCode: string }>> {
  const auth = await authorizeApi('bed.write', BED_DENIED);
  if (!auth.ok) return auth;
  const p = admitInputSchema.safeParse(input);
  if (!p.success) return { ok: false, message: issue(p.error) };
  return attempt(async () => {
    const r = await api('/api/v1/adt/admissions', {
      method: 'POST',
      body: p.data,
      schema: admissionResultApiSchema,
    });
    return { encounterId: r.encounterId, wristbandCode: r.wristbandCode };
  });
}

export async function transferAction(input: unknown): Promise<ApiActionResult<{ bedId: string }>> {
  const auth = await authorizeApi('bed.write', BED_DENIED);
  if (!auth.ok) return auth;
  const p = transferInputSchema.safeParse(input);
  if (!p.success) return { ok: false, message: issue(p.error) };
  return attempt(() =>
    api('/api/v1/adt/transfers', { method: 'POST', body: p.data, schema: z.object({ bedId: uuid }) }),
  );
}

/**
 * Pulang lewat `DischargeGate` API (gerbang lengkap K-1/resume dipasang potongan 3.6; diblokir → 409
 * `DISCHARGE_BLOCKED` beserta alasannya). Disposisi meninggal tidak dari layar ini.
 */
export async function dischargeAction(input: unknown): Promise<ApiActionResult<{ encounterId: string }>> {
  const auth = await authorizeApi('bed.write', BED_DENIED);
  if (!auth.ok) return auth;
  const p = dischargeInputSchema.safeParse(input);
  if (!p.success || p.data.disposition === 'meninggal') {
    return { ok: false, message: 'Pilih cara pulang (disposisi meninggal dicatat dokter penanggung jawab).' };
  }
  const data = p.data;
  return attempt(() =>
    api('/api/v1/adt/discharges', { method: 'POST', body: data, schema: z.object({ encounterId: uuid }) }),
  );
}

export async function reprintWristbandAction(
  encounterId: unknown,
  input: unknown,
): Promise<ApiActionResult<{ code: string }>> {
  const auth = await authorizeApi('bed.write', BED_DENIED);
  if (!auth.ok) return auth;
  const id = uuid.safeParse(encounterId);
  const p = wristbandReprintInputSchema.safeParse(input);
  if (!id.success || !p.success)
    return { ok: false, message: p.error ? issue(p.error) : 'Kunjungan tidak sah.' };
  return attempt(async () => {
    const r = await api(`/api/v1/encounters/${id.data}/wristband/reprint`, {
      method: 'POST',
      body: p.data,
      schema: wristbandPrintSchema,
    });
    return { code: r.code };
  });
}
