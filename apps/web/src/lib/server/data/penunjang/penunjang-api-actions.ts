'use server';

import {
  ABO_GROUPS,
  BLOOD_URGENCIES,
  bloodRequestRecordSchema,
  bloodUnitRecordSchema,
  CROSSMATCH_RESULTS,
  DIET_TEXTURES,
  dietOrderRecordSchema,
  MEAL_LEFTOVERS,
  mealServiceRecordSchema,
  MEALS,
  MST_WEIGHT_LOSS,
  npoRecordSchema,
  nutritionScreeningRecordSchema,
  RH_FACTORS,
  SAFETY_REASON_MIN,
  transfusionRecordSchema,
  transfusionVitalsInputSchema,
  transfusionVitalsResultSchema,
} from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * S07 Gizi + S08 Bank darah · Server Action mode api (fase 4 · 4.9, ADR-0105). Sesi + izin diperiksa di sini untuk
 * pesan yang jelas; API menegakkan ulang semua gerbang (ABO/Rh, crossmatch, cek ganda dua petugas, gelang ↔ kantong,
 * petugas kedua) dan mencatat audit. Pelaku selalu dari sesi; waktu catat dari server. Klien memanggil
 * `router.refresh()` setelah aksi berhasil.
 */

export type PenunjangActionResult =
  { ok: true; message: string; reaction?: string[] } | { ok: false; message: string; code?: string };

async function authorize(
  resource: string,
  action: string,
  denied: string,
): Promise<PenunjangActionResult | null> {
  if (webEnv().dataSource !== 'api') return { ok: false, message: 'Aksi ini hanya tersedia di mode api.' };
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, resource, action) ? null : { ok: false, message: denied };
}

function failure(err: unknown): PenunjangActionResult {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { ok: false, code: err.code, message: err.message };
  }
  return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
}

const invalid = (e: z.ZodError): PenunjangActionResult => ({
  ok: false,
  message: e.issues[0]?.message ?? 'Isian tidak lengkap.',
});

async function run<T>(
  fn: () => Promise<T>,
  ok: (v: T) => PenunjangActionResult,
): Promise<PenunjangActionResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return failure(err);
  }
}

const uuid = z.uuid();
const scan = (label: string) => z.string().trim().min(1, `Pindai atau ketik ${label}.`).max(64);

// ═════════════════════════════ S07 · Gizi ═════════════════════════════

const NO_NUTRITION = 'Peran Anda tidak berizin mengubah order diet atau layanan makan.';

const dietInput = z.strictObject({
  encounterId: uuid,
  dietTypeId: z.uuid('Pilih jenis diet.'),
  texture: z.enum(DIET_TEXTURES),
  notes: z.string().trim().max(500),
  startsOn: z.iso.date('Isi tanggal mulai diet.'),
});

export async function orderDietAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('nutrition', 'write', NO_NUTRITION);
  if (denied) return denied;
  const input = dietInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  return run(
    () =>
      api('/api/v1/nutrition/diet-orders', {
        method: 'POST',
        body: { ...input.data, notes: input.data.notes || null },
        schema: dietOrderRecordSchema,
      }),
    (d) => ({ ok: true, message: `Order diet ${d.dietType.name} (${d.texture}) aktif mulai ${d.startsOn}.` }),
  );
}

export async function endDietAction(id: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('nutrition', 'write', NO_NUTRITION);
  if (denied) return denied;
  const v = uuid.safeParse(id);
  if (!v.success) return { ok: false, message: 'Order diet tidak valid.' };
  return run(
    () =>
      api(`/api/v1/nutrition/diet-orders/${v.data}/end`, { method: 'POST', schema: dietOrderRecordSchema }),
    () => ({ ok: true, message: 'Order diet dihentikan.' }),
  );
}

const mealInput = z.strictObject({
  dietOrderId: uuid,
  meal: z.enum(MEALS),
  leftover: z.enum(MEAL_LEFTOVERS).nullable(),
});

/** Antar makan (sisa belum dinilai) atau catat sisa makanan; waktu antar = jam server web. */
export async function recordMealAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('nutrition', 'write', NO_NUTRITION);
  if (denied) return denied;
  const input = mealInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  return run(
    () =>
      api('/api/v1/nutrition/meal-services', {
        method: 'POST',
        body: { ...input.data, servedAt: new Date().toISOString() },
        schema: mealServiceRecordSchema,
      }),
    (m) => ({ ok: true, message: m.leftover ? 'Sisa makanan tercatat.' : 'Makanan tercatat diantar.' }),
  );
}

const screenInput = z.strictObject({
  encounterId: uuid,
  weightLoss: z.enum(MST_WEIGHT_LOSS, 'Pilih penurunan berat badan.'),
  poorAppetite: z.boolean(),
});

/** Skrining gizi MST (4.9b); skor dihitung server. */
export async function screenNutritionAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('nutrition', 'write', NO_NUTRITION);
  if (denied) return denied;
  const input = screenInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  return run(
    () =>
      api('/api/v1/nutrition/screenings', {
        method: 'POST',
        body: input.data,
        schema: nutritionScreeningRecordSchema,
      }),
    (r) => ({
      ok: true,
      message: `Skrining MST tercatat: skor ${r.score}${r.atRisk ? ' (berisiko malnutrisi, asuhan ahli gizi ≤ 24 jam)' : ''}.`,
    }),
  );
}

const npoInput = z.strictObject({
  encounterId: uuid,
  reason: z
    .string()
    .trim()
    .min(SAFETY_REASON_MIN, `Tulis alasan puasa minimal ${SAFETY_REASON_MIN} karakter.`)
    .max(500),
  plannedUntil: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)]),
});

export async function startNpoAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('nutrition', 'write', NO_NUTRITION);
  if (denied) return denied;
  const input = npoInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  const { plannedUntil, ...rest } = input.data;
  return run(
    () =>
      api('/api/v1/nutrition/npo', {
        method: 'POST',
        body: {
          ...rest,
          plannedUntil: plannedUntil ? new Date(`${plannedUntil}:00+07:00`).toISOString() : null,
        },
        schema: npoRecordSchema,
      }),
    () => ({ ok: true, message: 'Puasa dimulai; makanan tidak diantar sampai puasa dicabut.' }),
  );
}

export async function liftNpoAction(id: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('nutrition', 'write', NO_NUTRITION);
  if (denied) return denied;
  const v = uuid.safeParse(id);
  if (!v.success) return { ok: false, message: 'Order puasa tidak valid.' };
  return run(
    () => api(`/api/v1/nutrition/npo/${v.data}/lift`, { method: 'POST', schema: npoRecordSchema }),
    () => ({ ok: true, message: 'Puasa dicabut.' }),
  );
}

export async function verifyDietAction(id: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('nutrition', 'verify', 'Verifikasi order diet oleh ahli gizi.');
  if (denied) return denied;
  const v = uuid.safeParse(id);
  if (!v.success) return { ok: false, message: 'Order diet tidak valid.' };
  return run(
    () =>
      api(`/api/v1/nutrition/diet-orders/${v.data}/verify`, {
        method: 'POST',
        schema: dietOrderRecordSchema,
      }),
    () => ({ ok: true, message: 'Order diet terverifikasi; makanan boleh disiapkan dan diantar.' }),
  );
}

// ═════════════════════════════ S08 · Bank darah ═════════════════════════════

const NO_BANK = 'Peran Anda bukan petugas bank darah.';
const NO_ISSUE = 'Peran Anda tidak berizin mengeluarkan kantong darah.';
const NO_TRANSFUSE = 'Peran Anda tidak berizin memasang atau memverifikasi transfusi.';

const requestInput = z.strictObject({
  encounterId: uuid,
  componentCode: z.string().trim().min(1, 'Pilih komponen darah.').max(20),
  units: z.coerce.number().int().min(1, 'Jumlah kantong 1–20.').max(20, 'Jumlah kantong 1–20.'),
  urgency: z.enum(BLOOD_URGENCIES),
  indication: z.string().trim().min(3, 'Tulis indikasi transfusi.').max(500),
  group: z.union([z.literal(''), z.string().regex(/^(A|B|AB|O)\|(pos|neg)$/)]),
});

export async function requestBloodAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'request', 'Permintaan darah dikirim oleh DPJP pasien.');
  if (denied) return denied;
  const input = requestInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  const { group, ...rest } = input.data;
  const [abo, rh] = group ? (group.split('|') as [string, string]) : [null, null];
  return run(
    () =>
      api('/api/v1/blood/requests', {
        method: 'POST',
        body: { ...rest, patientAbo: abo, patientRh: rh },
        schema: bloodRequestRecordSchema,
      }),
    (r) => ({ ok: true, message: `Permintaan darah ${r.requestNo} terkirim ke bank darah.` }),
  );
}

export async function receiveBloodRequestAction(id: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'crossmatch', NO_BANK);
  if (denied) return denied;
  const v = uuid.safeParse(id);
  if (!v.success) return { ok: false, message: 'Permintaan tidak valid.' };
  return run(
    () =>
      api(`/api/v1/blood/requests/${v.data}/receive`, { method: 'POST', schema: bloodRequestRecordSchema }),
    (r) => ({ ok: true, message: `Permintaan ${r.requestNo} dan sampel diterima.` }),
  );
}

const groupInput = z.strictObject({ requestId: uuid, abo: z.enum(ABO_GROUPS), rh: z.enum(RH_FACTORS) });

export async function setBloodGroupAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'crossmatch', NO_BANK);
  if (denied) return denied;
  const input = groupInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  return run(
    () =>
      api(`/api/v1/blood/requests/${input.data.requestId}/group`, {
        method: 'PUT',
        body: { abo: input.data.abo, rh: input.data.rh },
        schema: bloodRequestRecordSchema,
      }),
    (r) => ({
      ok: true,
      message: `Golongan pasien ${r.patientAbo} Rh${r.patientRh === 'pos' ? '+' : '−'} tercatat.`,
    }),
  );
}

const crossmatchInput = z.strictObject({
  bloodRequestId: uuid,
  bloodUnitId: z.uuid('Pilih kantong.'),
  result: z.enum(CROSSMATCH_RESULTS),
  method: z.string().trim().min(2, 'Isi metode crossmatch.').max(60),
});

export async function crossmatchAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'crossmatch', NO_BANK);
  if (denied) return denied;
  const input = crossmatchInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  return run(
    () =>
      api('/api/v1/blood/crossmatches', {
        method: 'POST',
        body: input.data,
        schema: bloodRequestRecordSchema,
      }),
    () => ({
      ok: true,
      message:
        input.data.result === 'cocok'
          ? 'Crossmatch cocok; kantong dicadangkan untuk pasien ini.'
          : 'Crossmatch tidak cocok; kantong tidak dipakai untuk pasien ini.',
    }),
  );
}

const checkInput = z.strictObject({
  bloodRequestId: uuid,
  bloodUnitId: z.uuid('Pilih kantong.'),
  checklist: z.strictObject({
    identitas: z.literal(true, 'Semua butir cek ganda wajib dicentang.'),
    nomor: z.literal(true, 'Semua butir cek ganda wajib dicentang.'),
    golongan: z.literal(true, 'Semua butir cek ganda wajib dicentang.'),
    kedaluwarsa: z.literal(true, 'Semua butir cek ganda wajib dicentang.'),
    kantong_utuh: z.literal(true, 'Semua butir cek ganda wajib dicentang.'),
  }),
  emergencyReason: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .min(SAFETY_REASON_MIN, `Alasan darurat minimal ${SAFETY_REASON_MIN} karakter.`)
      .max(500),
  ]),
});

export async function issueCheckAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'issue', NO_ISSUE);
  if (denied) return denied;
  const input = checkInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  return run(
    () =>
      api('/api/v1/blood/issue-checks', {
        method: 'POST',
        body: { ...input.data, emergencyReason: input.data.emergencyReason || null },
        schema: bloodRequestRecordSchema,
      }),
    () => ({
      ok: true,
      message: 'Cek ganda pertama tercatat. Petugas kedua mengeluarkan kantong dari sesinya sendiri.',
    }),
  );
}

export async function confirmIssueAction(issueCheckId: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'issue', NO_ISSUE);
  if (denied) return denied;
  const v = uuid.safeParse(issueCheckId);
  if (!v.success) return { ok: false, message: 'Cek ganda tidak valid.' };
  return run(
    () =>
      api('/api/v1/blood/issues', {
        method: 'POST',
        body: { issueCheckId: v.data },
        schema: bloodRequestRecordSchema,
      }),
    (r) => ({
      ok: true,
      message: `Kantong ${r.issues.at(-1)?.bagNo ?? ''} dikeluarkan untuk ${r.patient.name} (cek ganda dua petugas).`,
    }),
  );
}

const unitInput = z.strictObject({
  bagNo: z.string().trim().min(3, 'Isi nomor kantong.').max(40),
  componentCode: z.string().trim().min(1, 'Pilih komponen.').max(20),
  abo: z.enum(ABO_GROUPS),
  rh: z.enum(RH_FACTORS),
  collectedOn: z.iso.date('Isi tanggal ambil.'),
  expiresOn: z.iso.date('Isi tanggal kedaluwarsa.'),
});

export async function registerBloodUnitAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'crossmatch', NO_BANK);
  if (denied) return denied;
  const input = unitInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  const { collectedOn, expiresOn, ...rest } = input.data;
  return run(
    () =>
      api('/api/v1/blood/units', {
        method: 'POST',
        body: {
          ...rest,
          collectedAt: new Date(`${collectedOn}T08:00:00+07:00`).toISOString(),
          expiresAt: new Date(`${expiresOn}T23:59:00+07:00`).toISOString(),
        },
        schema: bloodUnitRecordSchema,
      }),
    (u) => ({ ok: true, message: `Kantong ${u.bagNo} masuk stok.` }),
  );
}

const vitals = z.strictObject({
  tempC: z.coerce.number().min(30, 'Suhu 30–45 °C.').max(45, 'Suhu 30–45 °C.'),
  systolic: z.coerce.number().int().min(30, 'Sistolik 30–300.').max(300, 'Sistolik 30–300.'),
  diastolic: z.coerce.number().int().min(10, 'Diastolik 10–200.').max(200, 'Diastolik 10–200.'),
  pulse: z.coerce.number().int().min(20, 'Nadi 20–250.').max(250, 'Nadi 20–250.'),
});

const startInput = z.strictObject({
  bloodIssueId: uuid,
  wristbandCode: scan('kode gelang pasien'),
  bagNo: scan('nomor kantong'),
  baseline: vitals,
});

export async function startTransfusionAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'transfuse', NO_TRANSFUSE);
  if (denied) return denied;
  const input = startInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  return run(
    () =>
      api('/api/v1/blood/transfusions', {
        method: 'POST',
        body: input.data,
        schema: transfusionRecordSchema,
      }),
    () => ({
      ok: true,
      message:
        'Gelang dan kantong cocok. Minta petugas kedua memverifikasi dari sesinya sebelum transfusi dimulai.',
    }),
  );
}

const verifyInput = z.strictObject({
  transfusionId: uuid,
  wristbandCode: scan('kode gelang pasien'),
  bagNo: scan('nomor kantong'),
});

export async function verifyTransfusionAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'transfuse', NO_TRANSFUSE);
  if (denied) return denied;
  const input = verifyInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  const { transfusionId, ...body } = input.data;
  return run(
    () =>
      api(`/api/v1/blood/transfusions/${transfusionId}/verify`, {
        method: 'POST',
        body,
        schema: transfusionRecordSchema,
      }),
    () => ({ ok: true, message: 'Verifikasi petugas kedua cocok. Transfusi berjalan.' }),
  );
}

const vitalsInput = vitals.extend({
  transfusionId: uuid,
  label: transfusionVitalsInputSchema.shape.label,
  signs: z.array(z.string().trim().min(1).max(60)).max(10),
});

export async function transfusionVitalsAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'transfuse', NO_TRANSFUSE);
  if (denied) return denied;
  const input = vitalsInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  const { transfusionId, ...body } = input.data;
  return run(
    () =>
      api(`/api/v1/blood/transfusions/${transfusionId}/vitals`, {
        method: 'POST',
        body,
        schema: transfusionVitalsResultSchema,
      }),
    (r) =>
      r.reaction
        ? {
            ok: true,
            reaction: r.reasons,
            message: `Dugaan reaksi transfusi: ${r.reasons.join(', ')}. Transfusi dihentikan; pertahankan jalur infus NaCl 0,9%, laporkan ke DPJP dan bank darah.`,
          }
        : { ok: true, message: 'TTV tercatat, tanpa tanda reaksi.' },
  );
}

export async function finishTransfusionAction(id: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'transfuse', NO_TRANSFUSE);
  if (denied) return denied;
  const v = uuid.safeParse(id);
  if (!v.success) return { ok: false, message: 'Transfusi tidak valid.' };
  return run(
    () =>
      api(`/api/v1/blood/transfusions/${v.data}/finish`, { method: 'POST', schema: transfusionRecordSchema }),
    () => ({ ok: true, message: 'Transfusi selesai tanpa reaksi.' }),
  );
}

const reactionInput = z.strictObject({
  bloodIssueId: uuid,
  severity: z.enum(['ringan', 'sedang', 'berat']),
  description: z
    .string()
    .trim()
    .min(SAFETY_REASON_MIN, `Uraikan reaksi minimal ${SAFETY_REASON_MIN} karakter.`)
    .max(2000),
});

export async function reportReactionAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'transfuse', NO_TRANSFUSE);
  if (denied) return denied;
  const input = reactionInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  return run(
    () =>
      api('/api/v1/blood/reactions', {
        method: 'POST',
        body: { ...input.data, occurredAt: new Date().toISOString() },
        schema: transfusionRecordSchema.nullable(),
      }),
    () => ({ ok: true, message: 'Laporan reaksi transfusi tercatat.' }),
  );
}

// ─── 4.9b · pembatalan + pemusnahan ───

const cancelInput = z.strictObject({
  requestId: uuid,
  reason: z
    .string()
    .trim()
    .min(SAFETY_REASON_MIN, `Tulis alasan pembatalan minimal ${SAFETY_REASON_MIN} karakter.`)
    .max(500),
});

export async function cancelBloodRequestAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'read', NO_BANK);
  if (denied) return denied;
  const input = cancelInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  return run(
    () =>
      api(`/api/v1/blood/requests/${input.data.requestId}/cancel`, {
        method: 'POST',
        body: { reason: input.data.reason },
        schema: bloodRequestRecordSchema,
      }),
    (r) => ({
      ok: true,
      message: `Permintaan ${r.requestNo} dibatalkan; kantong yang belum keluar dilepas.`,
    }),
  );
}

const disposalInput = z.strictObject({
  bloodUnitId: uuid,
  category: z.enum(['kedaluwarsa', 'rusak']),
  reason: z
    .string()
    .trim()
    .min(SAFETY_REASON_MIN, `Tulis alasan pemusnahan minimal ${SAFETY_REASON_MIN} karakter.`)
    .max(500),
});

export async function requestDisposalAction(raw: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'issue', NO_ISSUE);
  if (denied) return denied;
  const input = disposalInput.safeParse(raw);
  if (!input.success) return invalid(input.error);
  return run(
    () => api('/api/v1/blood/disposals', { method: 'POST', body: input.data, schema: bloodUnitRecordSchema }),
    (u) => ({
      ok: true,
      message: `Pemusnahan ${u.bagNo} diajukan; petugas kedua mengonfirmasi dari sesinya sendiri.`,
    }),
  );
}

export async function confirmDisposalAction(id: unknown): Promise<PenunjangActionResult> {
  const denied = await authorize('blood_bank', 'issue', NO_ISSUE);
  if (denied) return denied;
  const v = uuid.safeParse(id);
  if (!v.success) return { ok: false, message: 'Pengajuan tidak valid.' };
  return run(
    () => api(`/api/v1/blood/disposals/${v.data}/confirm`, { method: 'POST', schema: bloodUnitRecordSchema }),
    (u) => ({ ok: true, message: `Kantong ${u.bagNo} dimusnahkan (dua petugas).` }),
  );
}
