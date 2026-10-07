'use server';

import {
  ALLERGY_CATEGORIES,
  ALLERGY_CRITICALITIES,
  allergyRecordSchema,
  CONDITION_ROLES,
  conditionRecordSchema,
  DISCHARGE_DISPOSITIONS,
  deathCertificateSchema,
  encounterCloseResultSchema,
  formAnswersSchema,
  procedureRecordSchema,
  SAFETY_REASON_MIN,
} from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * K06 · K08 · K13 · Server Action bagan RME mode api (asesmen P07, diagnosis/prosedur/alergi/problem list, salah entri,
 * tutup kunjungan + surat kematian). Sesi + izin diperiksa di sini untuk pesan yang jelas; API menegakkan ulang
 * (izin, hak tulis per profesi formulir, ABAC, kode baku dari `ref`, DischargeGate) dan mencatat audit. Waktu kejadian =
 * jam server web saat aksi; penulis selalu dari sesi. Klien memanggil `router.refresh()` setelah berhasil.
 */

export type RekamActionResult = { ok: true; message: string } | { ok: false; message: string; code?: string };

async function authorize(
  resource: string,
  action: string,
  denied: string,
): Promise<RekamActionResult | null> {
  if (webEnv().dataSource !== 'api') return { ok: false, message: 'Aksi ini hanya tersedia di mode api.' };
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, resource, action) ? null : { ok: false, message: denied };
}

function failure(err: unknown): RekamActionResult {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { ok: false, code: err.code, message: err.message };
  }
  return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
}

const invalid = (e: z.ZodError): RekamActionResult => ({
  ok: false,
  message: e.issues[0]?.message ?? 'Isian tidak lengkap.',
});
const uuid = z.uuid();
const now = () => new Date().toISOString();
const NO_WRITE = 'Peran Anda tidak berizin menulis rekam klinis pasien ini.';
const reason = z
  .string()
  .trim()
  .min(SAFETY_REASON_MIN, `Alasan wajib (minimal ${SAFETY_REASON_MIN} karakter).`)
  .max(500);
const note = z.string().trim().max(500);

// ---------------------------------------------------------------------------------------------------------------
// Pencarian kode baku (ICD-10, ICD-9-CM) dari data rujukan
// ---------------------------------------------------------------------------------------------------------------

const conceptList = z.array(z.object({ code: z.string(), display: z.string(), active: z.boolean() }));

export async function searchCodeAction(
  system: unknown,
  q: unknown,
): Promise<{ ok: true; data: Array<{ code: string; display: string }> } | { ok: false; message: string }> {
  const denied = await authorize('ref', 'read', 'Peran Anda tidak berizin membaca data rujukan.');
  if (denied) return { ok: false, message: denied.message };
  const sys = z.enum(['icd10', 'icd9cm']).safeParse(system);
  const term = z.string().trim().min(2).max(100).safeParse(q);
  if (!sys.success || !term.success) return { ok: false, message: 'Ketik minimal 2 huruf kode atau nama.' };
  try {
    const rows = await api(
      `/api/v1/ref/concepts?system=${sys.data}&q=${encodeURIComponent(term.data)}&limit=15`,
      {
        schema: conceptList,
      },
    );
    return {
      ok: true,
      data: rows.filter((r) => r.active).map((r) => ({ code: r.code, display: r.display })),
    };
  } catch (err) {
    const f = failure(err);
    return { ok: false, message: f.message };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// K06 · Asesmen (formulir P07 dengan encounterId)
// ---------------------------------------------------------------------------------------------------------------

const assessmentInput = z.strictObject({
  patientId: uuid,
  encounterId: uuid,
  formCode: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
  answers: formAnswersSchema,
});

export async function saveAssessmentAction(raw: unknown): Promise<RekamActionResult> {
  const denied = await authorize(
    'forms.response',
    'write',
    'Peran Anda tidak berizin mengisi formulir klinis.',
  );
  if (denied) return denied;
  const p = assessmentInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  try {
    await api(`/api/v1/patients/${p.data.patientId}/forms/${p.data.formCode}/responses`, {
      method: 'POST',
      body: { answers: p.data.answers, encounterId: p.data.encounterId },
      schema: z.object({ id: uuid }),
    });
    return { ok: true, message: 'Asesmen tersimpan final; perubahan berikutnya lewat koreksi berversi.' };
  } catch (err) {
    return failure(err);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// K08 · Diagnosis, problem list, prosedur, alergi
// ---------------------------------------------------------------------------------------------------------------

const conditionInput = z.strictObject({
  encounterId: uuid,
  kind: z.enum(['encounter', 'problem_list']),
  role: z.enum(CONDITION_ROLES).nullable(),
  code: z.string().trim().min(3, 'Pilih kode ICD-10 dari pencarian.').max(10),
  note: note.nullable(),
});

export async function addConditionAction(raw: unknown): Promise<RekamActionResult> {
  const denied = await authorize('clinical', 'write', NO_WRITE);
  if (denied) return denied;
  const p = conditionInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  try {
    const r = await api('/api/v1/diagnosis/conditions', {
      method: 'POST',
      body: {
        ...p.data,
        role: p.data.kind === 'encounter' ? (p.data.role ?? 'sekunder') : null,
        clinicalStatus: 'active',
        note: p.data.note || null,
        occurredAt: now(),
        revision: { kind: 'baru' },
      },
      schema: conditionRecordSchema,
    });
    return {
      ok: true,
      message: `${r.code} ${r.display} tercatat${r.kind === 'problem_list' ? ' di problem list' : ` sebagai diagnosis ${r.role}`}.`,
    };
  } catch (err) {
    return failure(err);
  }
}

const procedureInput = z.strictObject({
  encounterId: uuid,
  code: z.string().trim().min(2, 'Pilih kode ICD-9-CM dari pencarian.').max(10),
  note: note.nullable(),
});

export async function addProcedureAction(raw: unknown): Promise<RekamActionResult> {
  const denied = await authorize('clinical', 'write', NO_WRITE);
  if (denied) return denied;
  const p = procedureInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  try {
    const r = await api('/api/v1/diagnosis/procedures', {
      method: 'POST',
      body: { ...p.data, note: p.data.note || null, occurredAt: now(), revision: { kind: 'baru' } },
      schema: procedureRecordSchema,
    });
    return { ok: true, message: `Tindakan ${r.code} ${r.display} tercatat.` };
  } catch (err) {
    return failure(err);
  }
}

const allergyInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('nkda'), patientId: uuid, encounterId: uuid }),
  z.strictObject({
    kind: z.literal('alergi'),
    patientId: uuid,
    encounterId: uuid,
    text: z.string().trim().min(2, 'Tulis nama alergen.').max(120),
    category: z.enum(ALLERGY_CATEGORIES),
    criticality: z.enum(ALLERGY_CRITICALITIES),
    reaction: z.string().trim().max(300),
  }),
]);

export async function addAllergyAction(raw: unknown): Promise<RekamActionResult> {
  const denied = await authorize('clinical', 'write', NO_WRITE);
  if (denied) return denied;
  const p = allergyInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  const d = p.data;
  try {
    await api('/api/v1/diagnosis/allergies', {
      method: 'POST',
      body:
        d.kind === 'nkda'
          ? {
              patientId: d.patientId,
              encounterId: d.encounterId,
              kind: 'nkda',
              substanceId: null,
              text: null,
              category: null,
              criticality: null,
              reaction: null,
              occurredAt: now(),
              revision: { kind: 'baru' },
            }
          : {
              patientId: d.patientId,
              encounterId: d.encounterId,
              kind: 'alergi',
              substanceId: null,
              text: d.text,
              category: d.category,
              criticality: d.criticality,
              reaction: d.reaction || null,
              occurredAt: now(),
              revision: { kind: 'baru' },
            },
      schema: allergyRecordSchema,
    });
    return {
      ok: true,
      message: d.kind === 'nkda' ? 'Tidak ada alergi obat (NKDA) tercatat.' : `Alergi ${d.text} tercatat.`,
    };
  } catch (err) {
    return failure(err);
  }
}

const errorInput = z.strictObject({
  target: z.enum(['conditions', 'procedures', 'allergies']),
  id: uuid,
  reason,
});

export async function enteredInErrorAction(raw: unknown): Promise<RekamActionResult> {
  const denied = await authorize('clinical', 'correct', 'Peran Anda tidak berizin menandai salah entri.');
  if (denied) return denied;
  const p = errorInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  try {
    await api(`/api/v1/diagnosis/${p.data.target}/${p.data.id}/entered-in-error`, {
      method: 'POST',
      body: { reason: p.data.reason },
      schema: z.object({ id: uuid, status: z.literal('entered_in_error') }).loose(),
    });
    return { ok: true, message: 'Ditandai salah entri; isi asli tetap terbaca di riwayat.' };
  } catch (err) {
    return failure(err);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// K13 · Tutup kunjungan (DischargeGate) + surat keterangan kematian
// ---------------------------------------------------------------------------------------------------------------

const closeInput = z.strictObject({ encounterId: uuid, disposition: z.enum(DISCHARGE_DISPOSITIONS) });

export async function closeEncounterAction(raw: unknown): Promise<RekamActionResult> {
  const denied = await authorize('clinical', 'write', 'Kunjungan ditutup oleh klinisi (DPJP).');
  if (denied) return denied;
  const p = closeInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  try {
    await api(`/api/v1/encounters/${p.data.encounterId}/close`, {
      method: 'POST',
      body: { disposition: p.data.disposition },
      schema: encounterCloseResultSchema,
    });
    return { ok: true, message: 'Kunjungan ditutup; rekam medis kunjungan ini terkunci.' };
  } catch (err) {
    // DischargeGate menyebut syarat yang kurang (`details.reasons`): tampilkan apa adanya, bukan pesan umum.
    const reasons =
      err instanceof ApiError ? (err.details as { reasons?: unknown } | undefined)?.reasons : undefined;
    if (err instanceof ApiError && Array.isArray(reasons) && reasons.length > 0) {
      return { ok: false, code: err.code, message: `${err.message}: ${reasons.join('; ')}.` };
    }
    return failure(err);
  }
}

const deathInput = z.strictObject({
  encounterId: uuid,
  diedAt: z.iso.datetime({ offset: true }),
  causeCode: z.string().trim().min(3, 'Pilih sebab kematian ICD-10 dari pencarian.').max(10),
  causeDisplay: z.string().trim().min(1).max(200),
  note: note.nullable(),
});

export async function certifyDeathAction(raw: unknown): Promise<RekamActionResult> {
  const denied = await authorize(
    'clinical',
    'sign',
    'Surat keterangan kematian ditandatangani dokter berelasi.',
  );
  if (denied) return denied;
  const p = deathInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  try {
    await api(`/api/v1/encounters/${p.data.encounterId}/death-certificate`, {
      method: 'POST',
      body: {
        revision: { kind: 'baru' },
        diedAt: p.data.diedAt,
        cause: { code: p.data.causeCode, display: p.data.causeDisplay },
        note: p.data.note || null,
      },
      schema: deathCertificateSchema,
    });
    return { ok: true, message: 'Surat keterangan kematian dibuat; TTE diproses.' };
  } catch (err) {
    return failure(err);
  }
}
