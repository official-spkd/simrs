'use server';

import {
  DIAGNOSTIC_KINDS,
  diagnosticReportS10Schema,
  formAnswersSchema,
  MICRO_REPORT_STAGES,
  microOrderRecordSchema,
  paReportRecordSchema,
  SUSCEPTIBILITY_RESULTS,
} from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * S02 Mikrobiologi/PA + S10 diagnostik lain · Server Action mode api (fase 4 · 4.8, ADR-0120). Sesi + izin diperiksa
 * di sini untuk pesan yang jelas; API menegakkan ulang (urutan tahap, isolat terkunci, dua validator, versi + TTE,
 * isian formulir) dan mencatat audit. Klien memanggil `router.refresh()` setelah aksi berhasil.
 */

export type LabActionResult = { ok: true; message: string } | { ok: false; message: string; code?: string };

async function authorize(resource: string, action: string, denied: string): Promise<LabActionResult | null> {
  if (webEnv().dataSource !== 'api') return { ok: false, message: 'Aksi ini hanya tersedia di mode api.' };
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, resource, action) ? null : { ok: false, message: denied };
}

async function run<T>(fn: () => Promise<T>, ok: (v: T) => string): Promise<LabActionResult> {
  try {
    return { ok: true, message: ok(await fn()) };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) redirect('/masuk');
      return { ok: false, code: err.code, message: err.message };
    }
    return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
  }
}

const invalid = (e: z.ZodError): LabActionResult => ({
  ok: false,
  message: e.issues[0]?.message ?? 'Isian tidak lengkap.',
});
const uuid = z.uuid();

// ═════════════════════════════ S02 · Mikrobiologi ═════════════════════════════

const isolateInput = z.strictObject({
  labOrderId: uuid,
  stage: z.enum(MICRO_REPORT_STAGES),
  organismCode: z.string().trim().min(1, 'Isi organisme.').max(40),
  growth: z.string().trim().min(1, 'Isi pertumbuhan/pewarnaan.').max(120),
  susceptibilities: z
    .array(
      z.strictObject({
        antibioticCode: z.string().trim().min(1).max(40),
        result: z.enum(SUSCEPTIBILITY_RESULTS),
        mic: z.string().trim().max(12),
      }),
    )
    .max(60),
});

export async function addIsolateAction(raw: unknown): Promise<LabActionResult> {
  const denied = await authorize('lab.result', 'write', 'Peran Anda tidak berizin mencatat isolat.');
  if (denied) return denied;
  const input = isolateInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  const susceptibilities = input.data.susceptibilities.map((s) => ({
    antibioticCode: s.antibioticCode,
    result: s.result,
    micValue: s.mic ? Number(s.mic.replace(',', '.')) : null,
  }));
  if (susceptibilities.some((s) => s.micValue !== null && !(s.micValue > 0))) {
    return { ok: false, message: 'MIC harus angka positif.' };
  }
  return run(
    () =>
      api('/api/v1/micro/isolates', {
        method: 'POST',
        body: { ...input.data, susceptibilities },
        schema: microOrderRecordSchema,
      }),
    () => `Isolat ${input.data.organismCode} tercatat (${input.data.stage}).`,
  );
}

const technicalInput = z.strictObject({
  labOrderId: uuid,
  stage: z.enum(MICRO_REPORT_STAGES),
  conclusion: z.string().trim().min(3, 'Tulis kesimpulan laporan.').max(2000),
});

export async function microTechnicalAction(raw: unknown): Promise<LabActionResult> {
  const denied = await authorize('lab.result', 'verify', 'Validasi teknis oleh analis lab.');
  if (denied) return denied;
  const input = technicalInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  return run(
    () => api('/api/v1/micro/reports', { method: 'POST', body: input.data, schema: microOrderRecordSchema }),
    () => `Laporan ${input.data.stage} divalidasi teknis; menunggu rilis klinis dokter.`,
  );
}

export async function microReleaseAction(reportId: unknown): Promise<LabActionResult> {
  const denied = await authorize('lab.result', 'release', 'Rilis klinis oleh dokter penanggung jawab lab.');
  if (denied) return denied;
  const v = uuid.safeParse(reportId);
  if (!v.success) return { ok: false, message: 'Laporan tidak valid.' };
  return run(
    () => api(`/api/v1/micro/reports/${v.data}/release`, { method: 'POST', schema: microOrderRecordSchema }),
    () => 'Laporan dirilis dengan TTE.',
  );
}

// ═════════════════════════════ S02 · Patologi anatomi ═════════════════════════════

const paInput = z.strictObject({
  encounterId: uuid,
  surgerySpecimenId: uuid.nullable(),
  specimenSite: z.string().trim().min(2, 'Isi lokasi/jenis spesimen.').max(200),
  macroscopic: z.string().trim().min(5, 'Isi makroskopik.').max(8000),
  microscopic: z.string().trim().min(5, 'Isi mikroskopik.').max(8000),
  diagnosis: z.string().trim().min(5, 'Isi diagnosis.').max(2000),
  icd10: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/, 'Kode ICD-10 tidak valid.'),
  ]),
});

export async function paReportAction(raw: unknown): Promise<LabActionResult> {
  const denied = await authorize(
    'lab.result',
    'release',
    'Laporan PA oleh dokter spesialis patologi anatomi.',
  );
  if (denied) return denied;
  const input = paInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  return run(
    () =>
      api('/api/v1/pa/reports', {
        method: 'POST',
        body: {
          ...input.data,
          icd10: input.data.icd10 || null,
          surgeryCaseId: null,
          imageDocumentIds: [],
          occurredAt: new Date().toISOString(),
          revision: { kind: 'baru' },
        },
        schema: paReportRecordSchema,
      }),
    () => 'Laporan PA tersimpan; tandatangani (TTE) bila sudah final.',
  );
}

export async function paSignAction(id: unknown): Promise<LabActionResult> {
  const denied = await authorize(
    'lab.result',
    'release',
    'TTE laporan PA oleh dokter spesialis patologi anatomi.',
  );
  if (denied) return denied;
  const v = uuid.safeParse(id);
  if (!v.success) return { ok: false, message: 'Laporan tidak valid.' };
  return run(
    () => api(`/api/v1/pa/reports/${v.data}/sign`, { method: 'POST', schema: paReportRecordSchema }),
    () => 'Laporan PA ditandatangani (TTE).',
  );
}

// ═════════════════════════════ S10 · Diagnostik lain ═════════════════════════════

const diagInput = z.strictObject({
  serviceRequestId: uuid,
  kind: z.enum(DIAGNOSTIC_KINDS),
  answers: formAnswersSchema,
  conclusion: z.string().trim().min(5, 'Tulis kesimpulan minimal 5 karakter.').max(4000),
});

/** Isi formulir `diag_<jenis>` lalu simpan laporan dari isian itu (dua panggilan API, keduanya diaudit). */
export async function diagnosticReportAction(raw: unknown): Promise<LabActionResult> {
  const denied = await authorize(
    'diagnostics',
    'write',
    'Peran Anda tidak berizin menulis laporan diagnostik.',
  );
  if (denied) return denied;
  const input = diagInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  return run(
    async () => {
      const form = await api(`/api/v1/diagnostics/requests/${input.data.serviceRequestId}/form`, {
        method: 'POST',
        body: { answers: input.data.answers },
        schema: z.strictObject({ formResponseId: uuid }),
      });
      return api('/api/v1/diagnostics/reports', {
        method: 'POST',
        body: {
          serviceRequestId: input.data.serviceRequestId,
          kind: input.data.kind,
          formResponseId: form.formResponseId,
          documentIds: [],
          conclusion: input.data.conclusion,
          occurredAt: new Date().toISOString(),
        },
        schema: diagnosticReportS10Schema,
      });
    },
    () => 'Laporan tersimpan; tandatangani (TTE) bila sudah final.',
  );
}

export async function diagnosticSignAction(id: unknown): Promise<LabActionResult> {
  const denied = await authorize(
    'diagnostics',
    'sign',
    'Peran Anda tidak berizin menandatangani laporan diagnostik.',
  );
  if (denied) return denied;
  const v = uuid.safeParse(id);
  if (!v.success) return { ok: false, message: 'Laporan tidak valid.' };
  return run(
    () =>
      api(`/api/v1/diagnostics/reports/${v.data}/sign`, {
        method: 'POST',
        schema: diagnosticReportS10Schema,
      }),
    () => 'Laporan ditandatangani (TTE) dan tampil di panel hasil.',
  );
}
