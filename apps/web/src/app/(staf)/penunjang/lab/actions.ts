'use server';

import {
  labOrderAcceptInputSchema,
  labOrderDetailSchema,
  labQcRunInputSchema,
  labQcRunSchema,
  labResultCorrectionInputSchema,
  labResultInputSchema,
  specimenRejectInputSchema,
} from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * S01 · Server Action layar Laboratorium mode api (potongan 4.2): BFF tipis ke `/api/v1/lab/*`. Sesi + izin diperiksa
 * di sini agar pesan jelas; API menegakkan ulang izin, lingkup unit lab, status spesimen, gerbang nilai kritis/QC,
 * dan urutan validasi. Jalur presentasi di `actions-demo.ts`.
 */

export type LabActionResult = { ok: true; message: string; orderId: string } | { ok: false; message: string };

type Perm = ['lab.specimen' | 'lab.result' | 'lab.qc', string];

async function authorize(
  [resource, action]: Perm,
  message: string,
): Promise<{ ok: false; message: string } | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, resource, action) ? null : { ok: false, message };
}

function failure(err: unknown): { ok: false; message: string } {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { ok: false, message: err.message };
  }
  return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
}

const refresh = () => revalidatePath('/penunjang/lab');
const id = z.uuid();

/** Terima order CPOE → nomor lab + spesimen berbarcode. `key` = Idempotency-Key dari klien (sekali per tindakan). */
export async function acceptLabOrderAction(input: unknown, key: unknown): Promise<LabActionResult> {
  const denied = await authorize(['lab.specimen', 'receive'], 'Peran Anda tidak berizin menerima order lab.');
  if (denied) return denied;
  const body = labOrderAcceptInputSchema.safeParse(input);
  const k = id.safeParse(key);
  if (!body.success || !k.success) return { ok: false, message: 'Order yang dipilih tidak valid.' };
  try {
    const d = await api('/api/v1/lab/orders', {
      method: 'POST',
      body: body.data,
      idempotencyKey: k.data,
      schema: labOrderDetailSchema,
    });
    refresh();
    return {
      ok: true,
      message: `Order diterima: ${d.labNo}, ${d.specimens.length} label spesimen.`,
      orderId: d.id,
    };
  } catch (err) {
    return failure(err);
  }
}

const SPECIMEN_PERM: Record<'collect' | 'receive' | 'reject', Perm> = {
  collect: ['lab.specimen', 'collect'],
  receive: ['lab.specimen', 'receive'],
  reject: ['lab.specimen', 'reject'],
};

export async function specimenAction(
  specimenId: unknown,
  action: 'collect' | 'receive' | 'reject',
  payload: unknown,
): Promise<LabActionResult> {
  const denied = await authorize(
    SPECIMEN_PERM[action],
    'Peran Anda tidak berizin untuk tindakan spesimen ini.',
  );
  if (denied) return denied;
  const sid = id.safeParse(specimenId);
  if (!sid.success) return { ok: false, message: 'Spesimen tidak valid.' };
  let body: unknown = {};
  if (action === 'collect') body = { occurredAt: new Date().toISOString() };
  if (action === 'reject') {
    const r = specimenRejectInputSchema.safeParse(payload);
    if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? 'Pilih alasan penolakan.' };
    body = r.data;
  }
  try {
    const d = await api(`/api/v1/lab/specimens/${sid.data}/${action}`, {
      method: 'POST',
      body,
      schema: labOrderDetailSchema,
    });
    refresh();
    const label = {
      collect: 'Spesimen diambil',
      receive: 'Spesimen diterima lab',
      reject: 'Spesimen ditolak; label baru dibuat',
    };
    return { ok: true, message: `${label[action]}.`, orderId: d.id };
  } catch (err) {
    return failure(err);
  }
}

export async function enterLabResultsAction(orderId: unknown, input: unknown): Promise<LabActionResult> {
  const denied = await authorize(['lab.result', 'write'], 'Peran Anda tidak berizin menginput hasil lab.');
  if (denied) return denied;
  const oid = id.safeParse(orderId);
  const body = labResultInputSchema.safeParse(input);
  if (!oid.success || !body.success) {
    return {
      ok: false,
      message: body.success ? 'Order tidak valid.' : 'Isi nilai hasil yang valid untuk setiap tes.',
    };
  }
  try {
    const d = await api(`/api/v1/lab/orders/${oid.data}/results`, {
      method: 'POST',
      body: body.data,
      schema: labOrderDetailSchema,
    });
    refresh();
    const critical = d.results.some((r) => r.flag === 'KRITIS');
    return {
      ok: true,
      message: critical
        ? 'Hasil tersimpan. Ada nilai kritis: laporkan ke dokter dengan read-back sebelum validasi.'
        : 'Hasil tersimpan.',
      orderId: d.id,
    };
  } catch (err) {
    return failure(err);
  }
}

export async function validateLabAction(
  orderId: unknown,
  level: 'teknis' | 'klinis',
  qcOverrideReason: unknown,
): Promise<LabActionResult> {
  const denied = await authorize(
    level === 'teknis' ? ['lab.result', 'verify'] : ['lab.result', 'release'],
    level === 'teknis'
      ? 'Peran Anda tidak berizin memvalidasi teknis.'
      : 'Validasi klinis (rilis) hanya oleh dokter laboratorium.',
  );
  if (denied) return denied;
  const oid = id.safeParse(orderId);
  if (!oid.success) return { ok: false, message: 'Order tidak valid.' };
  const reason = z
    .string()
    .trim()
    .max(500)
    .safeParse(qcOverrideReason ?? '');
  try {
    const d = await api(
      `/api/v1/lab/orders/${oid.data}/validations/${level === 'teknis' ? 'technical' : 'clinical'}`,
      {
        method: 'POST',
        body:
          level === 'teknis' ? { qcOverrideReason: reason.success && reason.data ? reason.data : null } : {},
        schema: labOrderDetailSchema,
      },
    );
    refresh();
    return {
      ok: true,
      message:
        level === 'teknis'
          ? 'Validasi teknis tercatat.'
          : 'Hasil dirilis; TTE diproses dan DPJP diberi tahu.',
      orderId: d.id,
    };
  } catch (err) {
    return failure(err);
  }
}

export async function correctLabResultAction(resultId: unknown, input: unknown): Promise<LabActionResult> {
  const denied = await authorize(['lab.result', 'correct'], 'Peran Anda tidak berizin mengoreksi hasil lab.');
  if (denied) return denied;
  const rid = id.safeParse(resultId);
  const body = labResultCorrectionInputSchema.safeParse(input);
  if (!rid.success || !body.success) {
    return { ok: false, message: 'Isi nilai koreksi dan alasan (minimal 10 karakter).' };
  }
  try {
    const d = await api(`/api/v1/lab/results/${rid.data}/corrections`, {
      method: 'POST',
      body: body.data,
      schema: labOrderDetailSchema,
    });
    refresh();
    return { ok: true, message: 'Hasil dikoreksi; validasi ulang diperlukan.', orderId: d.id };
  } catch (err) {
    return failure(err);
  }
}

export async function qcRunAction(
  input: unknown,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const denied = await authorize(['lab.qc', 'write'], 'Peran Anda tidak berizin mencatat QC.');
  if (denied) return denied;
  const body = labQcRunInputSchema.safeParse(input);
  if (!body.success) return { ok: false, message: 'Lengkapi tes, level kontrol, nilai, mean, dan SD (> 0).' };
  try {
    const run = await api('/api/v1/lab/qc', { method: 'POST', body: body.data, schema: labQcRunSchema });
    refresh();
    const label = {
      ok: 'dalam batas',
      warn: 'peringatan 1-2s',
      reject: `DITOLAK (${run.violations.join(', ')})`,
    };
    return { ok: true, message: `QC tercatat: ${label[run.outcome]}.` };
  } catch (err) {
    return failure(err);
  }
}
