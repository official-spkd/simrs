'use server';

import {
  dischargeAddendumInputSchema,
  type DischargeDraftInput,
  dischargeDraftInputSchema,
  dischargeSummaryViewSchema,
} from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * K13 · Server Action layar Resume medis mode api (W5b). BFF: sesi + izin diperiksa di sini agar pesannya jelas, lalu
 * ditegakkan ulang API (`clinical.write` draf; `clinical.sign` + tim DPJP untuk rekonsiliasi, TTE, addendum; 12 butir
 * server; kunci TTE). Penulis selalu dari sesi API.
 */

export type ResumeActionResult = { ok: true; message: string } | { ok: false; message: string };

const uuid = z.uuid();

async function gate(resource: string, action: string, denied: string): Promise<string | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, resource, action) ? null : denied;
}

function failed(err: unknown): ResumeActionResult {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { ok: false, message: err.message };
  }
  throw err;
}

export async function createResumeDraftAction(encounterId: unknown): Promise<ResumeActionResult> {
  const denied = await gate('clinical', 'write', 'Peran Anda tidak berizin menyusun resume.');
  if (denied) return { ok: false, message: denied };
  const id = uuid.safeParse(encounterId);
  if (!id.success) return { ok: false, message: 'Kunjungan tidak dikenal.' };
  try {
    await api('/api/v1/discharge/summaries', {
      method: 'POST',
      body: { encounterId: id.data },
      schema: dischargeSummaryViewSchema,
    });
    return { ok: true, message: 'Draf resume dihimpun dari CPPT, observasi, hasil, diagnosis, dan order.' };
  } catch (err) {
    return failed(err);
  }
}

export async function saveResumeDraftAction(
  encounterId: unknown,
  input: DischargeDraftInput,
): Promise<ResumeActionResult> {
  const denied = await gate('clinical', 'write', 'Peran Anda tidak berizin menyusun resume.');
  if (denied) return { ok: false, message: denied };
  const id = uuid.safeParse(encounterId);
  const body = dischargeDraftInputSchema.safeParse(input);
  if (!id.success || !body.success) {
    return { ok: false, message: body.error?.issues[0]?.message ?? 'Isian resume tidak valid.' };
  }
  try {
    await api(`/api/v1/discharge/summaries/${id.data}/draft`, {
      method: 'PUT',
      body: body.data,
      schema: dischargeSummaryViewSchema,
    });
    return { ok: true, message: 'Draf resume tersimpan.' };
  } catch (err) {
    return failed(err);
  }
}

export async function reconcileAction(encounterId: unknown, confirmed: unknown): Promise<ResumeActionResult> {
  const denied = await gate('clinical', 'sign', 'Rekonsiliasi obat pulang dikonfirmasi DPJP.');
  if (denied) return { ok: false, message: denied };
  const id = uuid.safeParse(encounterId);
  const c = z.boolean().safeParse(confirmed);
  if (!id.success || !c.success) return { ok: false, message: 'Permintaan tidak valid.' };
  try {
    await api(`/api/v1/discharge/summaries/${id.data}/reconciliation`, {
      method: 'POST',
      body: { confirmed: c.data },
      schema: dischargeSummaryViewSchema,
    });
    return {
      ok: true,
      message: c.data ? 'Rekonsiliasi obat pulang dikonfirmasi.' : 'Konfirmasi dibatalkan.',
    };
  } catch (err) {
    return failed(err);
  }
}

const revision = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('baru') }),
  z.strictObject({
    kind: z.literal('koreksi'),
    supersedesId: uuid,
    correctionReason: z.string().trim().min(10).max(500),
  }),
]);

export async function finalizeResumeAction(encounterId: unknown, rev: unknown): Promise<ResumeActionResult> {
  const denied = await gate('clinical', 'sign', 'TTE resume hanya oleh DPJP.');
  if (denied) return { ok: false, message: denied };
  const id = uuid.safeParse(encounterId);
  const r = revision.safeParse(rev);
  if (!id.success || !r.success)
    return { ok: false, message: 'Permintaan tidak valid (alasan koreksi minimal 10 karakter).' };
  try {
    await api(`/api/v1/discharge/summaries/${id.data}/finalize`, {
      method: 'POST',
      body: { revision: r.data },
      schema: dischargeSummaryViewSchema,
    });
    return { ok: true, message: 'Resume final · TTE diminta; perubahan berikutnya hanya lewat addendum.' };
  } catch (err) {
    return failed(err);
  }
}

export async function addendumAction(summaryId: unknown, text: unknown): Promise<ResumeActionResult> {
  const denied = await gate('clinical', 'sign', 'Addendum ber-TTE hanya oleh dokter.');
  if (denied) return { ok: false, message: denied };
  const id = uuid.safeParse(summaryId);
  const body = dischargeAddendumInputSchema.safeParse({ text });
  if (!id.success || !body.success) return { ok: false, message: 'Addendum minimal 10 karakter.' };
  try {
    await api(`/api/v1/discharge/summaries/${id.data}/addenda`, {
      method: 'POST',
      body: body.data,
      schema: dischargeSummaryViewSchema,
    });
    return { ok: true, message: 'Addendum tersimpan · TTE diminta.' };
  } catch (err) {
    return failed(err);
  }
}
