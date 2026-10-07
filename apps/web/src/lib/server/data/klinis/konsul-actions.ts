'use server';

import {
  CARE_SETTINGS,
  carePackageItemInputSchema,
  carePackageItemSchema,
  careTeamMemberSchema,
  CONSULT_KINDS,
  CONSULT_QUESTION_MIN,
  CONSULT_URGENCIES,
  type ConsultantOption,
  consultantOptionSchema,
  consultantSearchQuerySchema,
  consultRequestRecordSchema,
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
 * K10 · K15 · Server Action konsultasi, tim perawatan, dan paket formulir mode api (fase 3 · 3.8, ADR-0059). Sesi +
 * izin diperiksa di sini untuk pesan yang jelas; API menegakkan ulang (penerima konsul, DPJP utama aktif, ABAC, versi
 * entri) dan mencatat audit. Waktu kejadian = jam server web saat aksi. Klien memanggil `router.refresh()` setelah
 * aksi berhasil.
 */

export type KonsulActionResult =
  { ok: true; message: string } | { ok: false; message: string; code?: string };

async function authorize(
  resource: string,
  action: string,
  denied: string,
): Promise<KonsulActionResult | null> {
  if (webEnv().dataSource !== 'api') return { ok: false, message: 'Aksi ini hanya tersedia di mode api.' };
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, resource, action) ? null : { ok: false, message: denied };
}

function failure(err: unknown): KonsulActionResult {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { ok: false, code: err.code, message: err.message };
  }
  return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
}

const invalid = (e: z.ZodError): KonsulActionResult => ({
  ok: false,
  message: e.issues[0]?.message ?? 'Isian tidak lengkap.',
});

const uuid = z.uuid();

/**
 * Pencarian dokter tujuan konsul / penerima DPJP utama (`GET /consults/consultants?q=`), dibatasi dan berurutan stabil
 * di API; pemilih di layar tidak memuat seluruh dokter RS.
 */
export async function searchConsultantsAction(
  q: unknown,
): Promise<{ ok: true; data: ConsultantOption[] } | { ok: false; message: string }> {
  const denied = await authorize('clinical', 'write', 'Peran Anda tidak berizin mengirim konsul.');
  if (denied) return { ok: false, message: denied.message };
  const query = consultantSearchQuerySchema.safeParse({ q });
  if (!query.success || !query.data.q)
    return { ok: false, message: 'Ketik minimal 2 huruf nama dokter atau unit.' };
  try {
    const data = await api(`/api/v1/consults/consultants?q=${encodeURIComponent(query.data.q)}`, {
      schema: consultantOptionSchema.array(),
    });
    return { ok: true, data };
  } catch (err) {
    const f = failure(err);
    return { ok: false, message: f.message };
  }
}

const NOT_CLINICIAN = 'Peran Anda tidak berizin menulis rekam klinis pasien ini.';

const sendInput = z.strictObject({
  encounterId: uuid,
  toUserId: z.uuid('Pilih dokter konsultan.'),
  kind: z.enum(CONSULT_KINDS),
  urgency: z.enum(CONSULT_URGENCIES),
  question: z
    .string()
    .trim()
    .min(
      CONSULT_QUESTION_MIN,
      `Tulis pertanyaan klinis yang jelas (minimal ${CONSULT_QUESTION_MIN} karakter).`,
    )
    .max(2000),
});

export async function sendConsultApiAction(raw: unknown): Promise<KonsulActionResult> {
  const denied = await authorize('clinical', 'write', NOT_CLINICIAN);
  if (denied) return denied;
  const input = sendInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  try {
    const r = await api('/api/v1/consults/requests', {
      method: 'POST',
      body: {
        ...input.data,
        toUnitId: null,
        occurredAt: new Date().toISOString(),
        revision: { kind: 'baru' },
      },
      schema: consultRequestRecordSchema,
    });
    return {
      ok: true,
      message: `Konsul terkirim ke ${r.toUser?.nama ?? 'konsultan'}; konsultan mendapat notifikasi.`,
    };
  } catch (err) {
    return failure(err);
  }
}

const answerInput = z.strictObject({
  requestId: uuid,
  findings: z.string().trim().max(2000),
  assessment: z.string().trim().min(1, 'Isi kesimpulan/diagnosis konsultan.').max(2000),
  recommendation: z.string().trim().min(1, 'Isi rekomendasi tata laksana.').max(2000),
  accept: z.boolean(),
});

export async function answerConsultApiAction(raw: unknown): Promise<KonsulActionResult> {
  const denied = await authorize('clinical', 'write', NOT_CLINICIAN);
  if (denied) return denied;
  const input = answerInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  const { requestId, ...answer } = input.data;
  try {
    const r = await api(`/api/v1/consults/requests/${requestId}/responses`, {
      method: 'POST',
      body: { ...answer, occurredAt: new Date().toISOString(), revision: { kind: 'baru' } },
      schema: consultRequestRecordSchema,
    });
    const follow = r.responses.at(-1)?.followUp;
    return {
      ok: true,
      message:
        follow === 'rawat_bersama'
          ? 'Jawaban tersimpan; Anda masuk tim perawatan sebagai DPJP rawat bersama.'
          : follow === 'alih_rawat'
            ? 'Jawaban tersimpan; Anda kini DPJP utama pasien ini.'
            : 'Jawaban konsul tersimpan; pengirim mendapat notifikasi.',
    };
  } catch (err) {
    return failure(err);
  }
}

const handoverInput = z.strictObject({
  encounterId: uuid,
  userId: z.uuid('Pilih dokter penerima.'),
  reason: z
    .string()
    .trim()
    .min(SAFETY_REASON_MIN, `Alasan wajib (minimal ${SAFETY_REASON_MIN} karakter).`)
    .max(500),
});

export async function changePrimaryApiAction(raw: unknown): Promise<KonsulActionResult> {
  const denied = await authorize('clinical', 'write', NOT_CLINICIAN);
  if (denied) return denied;
  const input = handoverInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  const { encounterId, ...body } = input.data;
  try {
    const team = await api(`/api/v1/encounters/${encounterId}/care-team/primary`, {
      method: 'POST',
      body,
      schema: careTeamMemberSchema.array(),
    });
    const now = team.find((m) => m.role === 'dpjp_utama' && !m.endedAt);
    return {
      ok: true,
      message: `DPJP utama kini ${now?.user.nama ?? 'dokter penerima'}; akses rekam ikut berpindah.`,
    };
  } catch (err) {
    return failure(err);
  }
}

const packageInput = z.strictObject({
  setting: z.enum(CARE_SETTINGS),
  formCode: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, 'Pilih formulir.'),
  item: carePackageItemInputSchema,
});

export async function upsertCarePackageAction(raw: unknown): Promise<KonsulActionResult> {
  const denied = await authorize(
    'forms.definition',
    'write',
    'Paket formulir dikelola pengelola formulir (petugas rekam medis).',
  );
  if (denied) return denied;
  const input = packageInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  try {
    const r = await api(`/api/v1/care-packages/${input.data.setting}/${input.data.formCode}`, {
      method: 'PUT',
      body: input.data.item,
      schema: carePackageItemSchema,
    });
    return {
      ok: true,
      message: `${r.formTitle ?? r.formCode}: ${r.active ? (r.required ? 'wajib' : 'opsional') : 'nonaktif'} di paket.`,
    };
  } catch (err) {
    return failure(err);
  }
}
