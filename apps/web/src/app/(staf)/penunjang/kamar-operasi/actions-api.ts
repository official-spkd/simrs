'use server';

import {
  checklistConfirmInputSchema,
  checklistItemInputSchema,
  countDiscrepancyInputSchema,
  operativeReportCreateSchema,
  type SurgeryCandidate,
  surgeryCancelInputSchema,
  surgeryCandidatesSchema,
  surgeryCaseInputSchema,
  type SurgeryCaseView,
  surgeryCaseViewSchema,
  surgeryEventInputSchema,
  surgerySupplyInputSchema,
  surgicalCountInputSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { type ApiActionResult, attempt, authorizeApi } from '@/lib/server/klinis-api-action';

/**
 * S06 · Server Action layar Kamar operasi mode api (4.7). Izin diperiksa di sini (pesan jelas) dan ditegakkan ulang API
 * (lingkup unit OK/relasi, urutan daftar tilik, gerbang insisi, hitung). Setiap aksi mengembalikan kasus terbaru.
 */

const uuid = z.uuid();
const issue = (e: z.ZodError) => e.issues[0]?.message ?? 'Isian tidak valid.';
type CaseResult = ApiActionResult<SurgeryCaseView>;

async function caseCall(
  perm: string,
  denied: string,
  caseId: unknown,
  path: string,
  body: unknown,
  schema: z.ZodType,
): Promise<CaseResult> {
  const auth = await authorizeApi(perm, denied);
  if (!auth.ok) return auth;
  const id = uuid.safeParse(caseId);
  if (!id.success) return { ok: false, message: 'Kasus tidak sah.' };
  const p = schema.safeParse(body);
  if (!p.success) return { ok: false, message: issue(p.error) };
  return attempt(() =>
    api(`/api/v1/surgery/cases/${id.data}${path}`, {
      method: 'POST',
      body: p.data,
      schema: surgeryCaseViewSchema,
    }),
  );
}

export async function scheduleCaseAction(input: unknown): Promise<CaseResult> {
  const auth = await authorizeApi('surgery.schedule', 'Peran Anda tidak berizin menjadwalkan operasi.');
  if (!auth.ok) return auth;
  const p = surgeryCaseInputSchema.safeParse(input);
  if (!p.success) return { ok: false, message: issue(p.error) };
  return attempt(() =>
    api('/api/v1/surgery/cases', { method: 'POST', body: p.data, schema: surgeryCaseViewSchema }),
  );
}

export async function searchCandidatesAction(q: unknown): Promise<ApiActionResult<SurgeryCandidate[]>> {
  const auth = await authorizeApi('surgery.schedule', 'Peran Anda tidak berizin menjadwalkan operasi.');
  if (!auth.ok) return auth;
  const p = z
    .string()
    .trim()
    .min(3, 'Masukkan minimal 3 karakter No. RM atau nomor kunjungan.')
    .max(40)
    .safeParse(q);
  if (!p.success) return { ok: false, message: issue(p.error) };
  return attempt(async () => {
    const r = await api(`/api/v1/surgery/candidates?q=${encodeURIComponent(p.data)}`, {
      schema: surgeryCandidatesSchema,
    });
    return r.items;
  });
}

export async function cancelCaseAction(caseId: unknown, input: unknown) {
  return caseCall(
    'surgery.schedule',
    'Peran Anda tidak berizin membatalkan operasi.',
    caseId,
    '/cancel',
    input,
    surgeryCancelInputSchema,
  );
}

export async function checkItemAction(caseId: unknown, input: unknown) {
  return caseCall(
    'surgery.checklist',
    'Peran Anda tidak berizin mengisi daftar tilik.',
    caseId,
    '/checklist/items',
    input,
    checklistItemInputSchema,
  );
}

export async function confirmPhaseAction(caseId: unknown, input: unknown) {
  return caseCall(
    'surgery.checklist',
    'Peran Anda tidak berizin mengonfirmasi daftar tilik.',
    caseId,
    '/checklist/confirm',
    input,
    checklistConfirmInputSchema,
  );
}

export async function recordEventAction(caseId: unknown, input: unknown) {
  return caseCall(
    'surgery.checklist',
    'Peran Anda tidak berizin mencatat peristiwa operasi.',
    caseId,
    '/events',
    input,
    surgeryEventInputSchema,
  );
}

export async function countAction(caseId: unknown, input: unknown) {
  return caseCall(
    'surgery.count',
    'Peran Anda tidak berizin mencatat hitung kasa.',
    caseId,
    '/counts',
    input,
    surgicalCountInputSchema,
  );
}

export async function discrepancyAction(caseId: unknown, input: unknown) {
  return caseCall(
    'surgery.count',
    'Peran Anda tidak berizin mencatat tindak lanjut hitung.',
    caseId,
    '/count-discrepancies',
    input,
    countDiscrepancyInputSchema,
  );
}

export async function suppliesAction(caseId: unknown, input: unknown) {
  return caseCall(
    'surgery.checklist',
    'Peran Anda tidak berizin mencatat BHP.',
    caseId,
    '/supplies',
    input,
    surgerySupplyInputSchema,
  );
}

export async function reportAction(caseId: unknown, input: unknown) {
  return caseCall(
    'surgery.report',
    'Peran Anda tidak berizin menulis laporan operasi.',
    caseId,
    '/reports',
    input,
    operativeReportCreateSchema,
  );
}
