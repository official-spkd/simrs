'use server';

import {
  activeWristbandScanSchema,
  CONSCIOUSNESS,
  cpptRecordSchema,
  doubleCheckViewSchema,
  handoverRecordSchema,
  MEDICATION_ADMINISTRATION_STATUSES,
  medicationAdministrationRecordSchema,
  nursingCarePlanRecordSchema,
  SAFETY_REASON_MIN,
  vitalSignsRecordSchema,
  wristbandPrintSchema,
  type WristbandPrint,
} from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * K04/K07/K12 · Server Action layar Rawat inap mode api (fase 3 layar W4). Satu-satunya jalan klien ke API (BFF):
 * sesi + izin diperiksa di sini agar pesannya jelas, lalu ditegakkan ulang API (izin, ABAC, pindai gelang, cek ganda,
 * co-sign, versi entri). Penulis, PPA, waktu catat, dan skor NEWS2 selalu dari server; waktu kejadian = jam server
 * web saat aksi. Tidak ada `revalidatePath`: klien memanggil `router.refresh()` setelah aksi berhasil.
 */

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; message: string; code?: string };

type Need = 'clinical.write' | 'clinical.cosign' | 'clinical.correct' | 'medication.administer' | 'bed.write';

const DENIED: Record<Need, string> = {
  'clinical.write': 'Peran Anda tidak berizin menulis rekam klinis pasien ini.',
  'clinical.cosign': 'Co-sign dan verifikasi CPPT hanya oleh DPJP (posisi dokter).',
  'clinical.correct': 'Peran Anda tidak berizin mengoreksi catatan klinis.',
  'medication.administer': 'Pemberian obat dan pindai gelang dicatat posisi perawat atau bidan.',
  'bed.write': 'Penggantian gelang dicatat posisi perawat, bidan, atau admisi.',
};

async function authorize(...needs: Need[]): Promise<{ ok: false; message: string } | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  for (const need of needs) {
    const [resource, action] = need.split('.') as [string, string];
    if (!can(s, resource, action)) return { ok: false, message: DENIED[need] };
  }
  return null;
}

function failure(err: unknown): { ok: false; message: string; code?: string } {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { ok: false, code: err.code, message: err.message };
  }
  return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
}

function invalid(e: z.ZodError): { ok: false; message: string } {
  return { ok: false, message: e.issues[0]?.message ?? 'Isian tidak lengkap.' };
}

const uuid = z.uuid();
const now = () => new Date().toISOString();
const reason = z
  .string()
  .trim()
  .min(SAFETY_REASON_MIN, `Alasan wajib (minimal ${SAFETY_REASON_MIN} karakter).`)
  .max(500);

// ---------------------------------------------------------------------------------------------------------------
// Observasi tanda vital (NEWS2 dihitung server)
// ---------------------------------------------------------------------------------------------------------------

const num = (label: string, min: number, max: number, int = true) =>
  z.coerce
    .number({ error: `${label} harus angka.` })
    .refine((v) => !int || Number.isInteger(v), `${label} harus bilangan bulat.`)
    .refine((v) => v >= min && v <= max, `${label} di luar rentang ${min}–${max}.`);

const vitalsInput = z.strictObject({
  encounterId: uuid,
  temp: num('Suhu', 30, 45, false),
  hr: num('Nadi', 20, 250),
  rr: num('Napas', 4, 60),
  sbp: num('TD sistolik', 40, 260),
  dbp: num('TD diastolik', 20, 160),
  spo2: num('SpO2', 50, 100),
  onOxygen: z.boolean(),
  consciousness: z.enum(CONSCIOUSNESS),
});

export interface VitalsResult {
  score: number;
  maxParam: number;
  risk: 'rendah' | 'sedang' | 'tinggi';
  escalated: boolean;
  at: string;
}

/** Catat tanda vital; skor NEWS2 dan keputusan eskalasi (notifikasi DPJP/tim + SSE `ews`) dari server. */
export async function recordVitalsAction(input: unknown): Promise<ActionResult<VitalsResult>> {
  const denied = await authorize('clinical.write');
  if (denied) return denied;
  const p = vitalsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { encounterId, ...v } = p.data;
  try {
    const r = await api(`/api/v1/encounters/${encounterId}/observations`, {
      method: 'POST',
      body: { encounterId, occurredAt: now(), ...v, weightKg: null },
      schema: vitalSignsRecordSchema,
    });
    return {
      ok: true,
      data: {
        score: r.ews.score,
        maxParam: r.ews.maxParam,
        risk: r.ews.risk,
        escalated: r.ews.escalated,
        at: r.occurredAt,
      },
    };
  } catch (err) {
    return failure(err);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// CPPT multi-PPA: baru, koreksi (penulis), addendum (PPA lain), co-sign/verifikasi DPJP, serah terima SBAR
// ---------------------------------------------------------------------------------------------------------------

const soap = z.strictObject({
  s: z.string().trim().min(1, 'S wajib diisi.').max(2000),
  o: z.string().trim().max(2000),
  a: z.string().trim().min(1, 'A wajib diisi.').max(2000),
  p: z.string().trim().max(2000),
});

const cpptInput = z.strictObject({
  encounterId: uuid,
  soap,
  mode: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('baru') }),
    z.strictObject({ kind: z.literal('koreksi'), targetId: uuid, reason }),
    z.strictObject({ kind: z.literal('addendum'), targetId: uuid }),
  ]),
});

export interface CpptSaved {
  status: 'menunggu_cosign' | 'final' | 'entered_in_error';
  version: number;
  at: string;
  abbreviationWarnings: string[];
}

/** Tulis CPPT (SOAP). PPA, penulis, dan kebutuhan co-sign residen ditentukan server dari sesi. */
export async function saveCpptAction(input: unknown): Promise<ActionResult<CpptSaved>> {
  const p = cpptInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const denied = await authorize(
    ...(p.data.mode.kind === 'koreksi'
      ? (['clinical.write', 'clinical.correct'] as const)
      : (['clinical.write'] as const)),
  );
  if (denied) return denied;
  const m = p.data.mode;
  const revision =
    m.kind === 'baru'
      ? { kind: 'baru' as const }
      : m.kind === 'koreksi'
        ? { kind: 'koreksi' as const, supersedesId: m.targetId, correctionReason: m.reason }
        : { kind: 'addendum' as const, addendumOf: m.targetId };
  try {
    const r = await api('/api/v1/cppt/entries', {
      method: 'POST',
      body: {
        encounterId: p.data.encounterId,
        occurredAt: now(),
        content: { format: 'soap', ...p.data.soap },
        instruction: null,
        revision,
      },
      schema: cpptRecordSchema,
    });
    return {
      ok: true,
      data: {
        status: r.status,
        version: r.version,
        at: r.recordedAt,
        abbreviationWarnings: r.abbreviationWarnings,
      },
    };
  } catch (err) {
    return failure(err);
  }
}

const attestInput = z.strictObject({ entryId: uuid, kind: z.enum(['cosign', 'verify']) });

/** Co-sign DPJP atas CPPT residen, atau verifikasi DPJP atas CPPT PPA lain (atestasi sesi). */
export async function attestCpptAction(input: unknown): Promise<ActionResult<{ at: string }>> {
  const denied = await authorize('clinical.cosign');
  if (denied) return denied;
  const p = attestInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    const r = await api(`/api/v1/cppt/entries/${p.data.entryId}/${p.data.kind}`, {
      method: 'POST',
      body: { note: null },
      schema: cpptRecordSchema,
    });
    const at = (p.data.kind === 'cosign' ? r.cosign?.at : r.verification?.at) ?? r.recordedAt;
    return { ok: true, data: { at } };
  } catch (err) {
    return failure(err);
  }
}

const handoverInput = z.strictObject({
  encounterId: uuid,
  situation: z.string().trim().min(1, 'S (situasi) wajib diisi.').max(1000),
  background: z.string().trim().max(1000),
  assessment: z.string().trim().min(1, 'A (asesmen) wajib diisi.').max(1000),
  recommendation: z.string().trim().min(1, 'R (rekomendasi) wajib diisi.').max(1000),
});

/** Serah terima SBAR ke shift/unit berikutnya (berversi; tercatat di CPPT pasien). */
export async function handoverAction(input: unknown): Promise<ActionResult<{ at: string }>> {
  const denied = await authorize('clinical.write');
  if (denied) return denied;
  const p = handoverInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    const r = await api('/api/v1/cppt/handovers', {
      method: 'POST',
      body: { ...p.data, occurredAt: now(), toUserId: null },
      schema: handoverRecordSchema,
    });
    return { ok: true, data: { at: r.recordedAt } };
  } catch (err) {
    return failure(err);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// eMAR: pindai gelang, ganti gelang (verifikasi dua identitas beralasan), pemberian dosis, cek ganda dua sesi
// ---------------------------------------------------------------------------------------------------------------

const scanInput = z.strictObject({
  encounterId: uuid,
  code: z.string().trim().min(1, 'Pindai atau ketik kode gelang.').max(64),
});

export interface ScanResult {
  scanId: string;
  scannedAt: string;
}

/** Pindai gelang: cocok → pindaian berlaku untuk pemberi ini; tidak cocok tetap tercatat dan diaudit (422). */
export async function scanWristbandAction(input: unknown): Promise<ActionResult<ScanResult>> {
  const denied = await authorize('medication.administer');
  if (denied) return denied;
  const p = scanInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    const r = await api('/api/v1/nursing/wristband-scans', {
      method: 'POST',
      body: p.data,
      schema: z.strictObject({
        id: uuid,
        matched: z.literal(true),
        scannedAt: z.iso.datetime({ offset: true }),
      }),
    });
    return { ok: true, data: { scanId: r.id, scannedAt: r.scannedAt } };
  } catch (err) {
    return failure(err);
  }
}

const replaceInput = z.strictObject({ encounterId: uuid, reason });

/**
 * Gelang tidak terbaca/rusak: verifikasi manual dua identitas + alasan → gelang lama dibatalkan dan gelang baru
 * terbit (tercatat + diaudit, dapat ditinjau). Tidak membuka eMAR: gelang baru tetap wajib dipindai (keputusan
 * fase 3 no. 8, tidak ada jalur melewati pindai).
 */
export async function replaceWristbandAction(input: unknown): Promise<ActionResult<WristbandPrint>> {
  const denied = await authorize('medication.administer', 'bed.write');
  if (denied) return denied;
  const p = replaceInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    const r = await api(`/api/v1/encounters/${p.data.encounterId}/wristband/reprint`, {
      method: 'POST',
      body: { reason: p.data.reason },
      schema: wristbandPrintSchema,
    });
    return { ok: true, data: r };
  } catch (err) {
    return failure(err);
  }
}

const doseFields = {
  medicationRequestId: uuid,
  scheduleId: uuid.nullable(),
  scanId: uuid,
  labelCode: z.string().trim().min(1, 'Pindai label obat lebih dulu.').max(64),
  status: z.enum(MEDICATION_ADMINISTRATION_STATUSES),
  reason: z.string().trim().max(500).nullable(),
};

const administerInput = z
  .strictObject({
    ...doseFields,
    /** Atestasi cek ganda (obat kewaspadaan tinggi); waktu dosis mengikuti atestasi. */
    doubleCheckId: uuid.nullable(),
    occurredAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.status !== 'given' && (v.reason ?? '').length < SAFETY_REASON_MIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: `Dosis ditunda/ditolak wajib beralasan (minimal ${SAFETY_REASON_MIN} karakter).`,
      });
    }
  });

export interface AdministrationResult {
  status: 'given' | 'held' | 'refused';
  at: string;
  late: boolean;
  doubleCheckedBy: string | null;
}

/** Catat satu dosis (diberikan/ditunda/ditolak). Pindaian gelang, label, keterlambatan, cek ganda diperiksa server. */
export async function administerAction(input: unknown): Promise<ActionResult<AdministrationResult>> {
  const denied = await authorize('medication.administer');
  if (denied) return denied;
  const p = administerInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { doubleCheckId, occurredAt, ...dose } = p.data;
  try {
    const r = await api('/api/v1/nursing/administrations', {
      method: 'POST',
      body: { ...dose, occurredAt: occurredAt ?? now(), doubleCheckUserId: null, doubleCheckId },
      schema: medicationAdministrationRecordSchema,
    });
    return {
      ok: true,
      data: { status: r.status, at: r.at, late: r.late, doubleCheckedBy: r.doubleCheckedBy?.nama ?? null },
    };
  } catch (err) {
    return failure(err);
  }
}

const doubleCheckInput = z.strictObject(doseFields).superRefine((v, ctx) => {
  if (v.status !== 'given') {
    ctx.addIssue({
      code: 'custom',
      path: ['status'],
      message: 'Cek ganda hanya untuk dosis yang akan diberikan.',
    });
  }
});

/**
 * Cek ganda obat kewaspadaan tinggi dari SESI perawat kedua (ADR-0077): atas pindaian gelang rekan yang masih
 * berlaku; isi dosis dibekukan server dan dipakai rekan saat mencatat pemberian.
 */
export async function doubleCheckAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await authorize('medication.administer');
  if (denied) return denied;
  const p = doubleCheckInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    const r = await api('/api/v1/nursing/double-checks', {
      method: 'POST',
      body: { ...p.data, occurredAt: now() },
      schema: z.object({ id: uuid }),
    });
    return { ok: true, data: { id: r.id } };
  } catch (err) {
    return failure(err);
  }
}

/** Muat ulang pindaian aktif + atestasi cek ganda (tanpa memuat ulang seluruh halaman). */
export async function emarAttestationsAction(encounterId: unknown) {
  const denied = await authorize('medication.administer');
  if (denied) return denied;
  const id = uuid.safeParse(encounterId);
  if (!id.success) return { ok: false as const, message: 'Kunjungan tidak dikenali.' };
  try {
    const [scans, checks] = await Promise.all([
      api(`/api/v1/nursing/wristband-scans?encounterId=${id.data}`, {
        schema: activeWristbandScanSchema.array(),
      }),
      api(`/api/v1/nursing/double-checks?encounterId=${id.data}`, { schema: doubleCheckViewSchema.array() }),
    ]);
    return { ok: true as const, data: { scans, checks } };
  } catch (err) {
    return failure(err);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Asuhan keperawatan + balans cairan
// ---------------------------------------------------------------------------------------------------------------

const carePlanInput = z.strictObject({
  encounterId: uuid,
  diagnosisId: uuid,
  goals: z.string().trim().min(1, 'Tujuan wajib diisi.').max(2000),
  interventions: z
    .array(z.string().trim().min(1).max(500))
    .min(1, 'Isi minimal satu intervensi (satu per baris).')
    .max(30),
  evaluation: z.string().trim().max(2000),
  /** Null = rencana baru; id = koreksi rencana itu (versi baru, alasan wajib). */
  supersedesId: uuid.nullable(),
  correctionReason: z.string().trim().max(500).nullable(),
});

/** Rencana asuhan keperawatan baru, atau pembaruan evaluasi sebagai versi baru (koreksi beralasan). */
export async function carePlanAction(input: unknown): Promise<ActionResult<{ version: number }>> {
  const p = carePlanInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const correcting = p.data.supersedesId !== null;
  const denied = await authorize(
    ...(correcting ? (['clinical.write', 'clinical.correct'] as const) : (['clinical.write'] as const)),
  );
  if (denied) return denied;
  if (correcting && (p.data.correctionReason ?? '').length < SAFETY_REASON_MIN) {
    return { ok: false, message: `Alasan perubahan wajib (minimal ${SAFETY_REASON_MIN} karakter).` };
  }
  const { supersedesId, correctionReason, evaluation, ...rest } = p.data;
  try {
    const r = await api('/api/v1/nursing/care-plans', {
      method: 'POST',
      body: {
        ...rest,
        evaluation: evaluation || null,
        occurredAt: now(),
        revision: supersedesId
          ? { kind: 'koreksi', supersedesId, correctionReason: correctionReason ?? '' }
          : { kind: 'baru' },
      },
      schema: nursingCarePlanRecordSchema,
    });
    return { ok: true, data: { version: r.version } };
  } catch (err) {
    return failure(err);
  }
}

const fluidInput = z.strictObject({
  encounterId: uuid,
  direction: z.enum(['intake', 'output']),
  route: z.string().trim().min(1, 'Jalur wajib diisi (mis. infus, oral, urin).').max(120),
  volumeMl: z.coerce
    .number({ error: 'Volume harus angka.' })
    .positive('Volume harus lebih dari 0 mL.')
    .max(100_000, 'Volume terlalu besar.'),
  note: z.string().trim().max(500),
});

/** Balans cairan: satu catatan masuk/keluar (observasi kategori `cairan`). */
export async function fluidAction(input: unknown): Promise<ActionResult> {
  const denied = await authorize('clinical.write');
  if (denied) return denied;
  const p = fluidInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    await api('/api/v1/nursing/fluid-balances', {
      method: 'POST',
      body: { ...p.data, note: p.data.note || null, occurredAt: now(), revision: { kind: 'baru' } },
      schema: z.object({ id: uuid }),
    });
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}
