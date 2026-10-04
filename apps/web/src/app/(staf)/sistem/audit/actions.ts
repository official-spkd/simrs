'use server';

import { AUDIT_ANOMALY_KEY, AUDIT_REVIEW_OUTCOMES, formatJam } from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { okSchema } from '@/lib/server/schemas';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * Keputusan tinjauan dari layar Audit. Sesi dan izin diperiksa di sini (pesan jelas) dan ditegakkan API
 * (izin, larangan meninjau diri sendiri, akses darurat hanya sekali ditinjau; temuan boleh ditinjau ulang dan
 * keputusan terbaru berlaku). Keputusan tercatat di jejak audit.
 */

const PATH = '/sistem/audit';

export interface ReviewResult {
  ok?: boolean;
  error?: string;
  message?: string;
}

const reviewInput = z.object({
  outcome: z.enum(AUDIT_REVIEW_OUTCOMES),
  note: z.string().trim().max(500).optional(),
});

async function authorize(resource: string, action: string): Promise<string | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, resource, action) ? null : 'Peran Anda tidak berizin meninjau.';
}

function readForm(formData: FormData) {
  const note = formData.get('note');
  return reviewInput.safeParse({
    outcome: formData.get('outcome'),
    note: typeof note === 'string' && note.trim() ? note : undefined,
  });
}

function failure(err: unknown): ReviewResult {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { error: err.message };
  }
  return { error: 'Terjadi kesalahan. Coba lagi.' };
}

export async function reviewBreakGlassAction(_prev: ReviewResult, formData: FormData): Promise<ReviewResult> {
  const denied = await authorize('break_glass', 'review');
  if (denied) return { error: denied };
  const id = z.uuid().safeParse(formData.get('id'));
  const input = readForm(formData);
  if (!id.success || !input.success) return { error: 'Keputusan tinjauan tidak valid.' };
  try {
    await api(`/api/v1/authz/break-glass/${id.data}/review`, {
      method: 'POST',
      body: input.data,
      schema: okSchema,
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(PATH);
  return { ok: true, message: `Ditinjau pukul ${formatJam(new Date())}.` };
}

export async function reviewFindingAction(_prev: ReviewResult, formData: FormData): Promise<ReviewResult> {
  const denied = await authorize('audit', 'review');
  if (denied) return { error: denied };
  const key = z.string().regex(AUDIT_ANOMALY_KEY).safeParse(formData.get('key'));
  const input = readForm(formData);
  if (!key.success || !input.success) return { error: 'Keputusan tinjauan tidak valid.' };
  try {
    await api('/api/v1/audit/anomalies/review', {
      method: 'POST',
      body: { key: key.data, ...input.data },
      schema: okSchema,
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(PATH);
  return { ok: true, message: `Ditinjau pukul ${formatJam(new Date())}.` };
}
