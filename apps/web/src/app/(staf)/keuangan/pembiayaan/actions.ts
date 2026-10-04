'use server';

import { INSTALMENT_STAGES } from '@simrs/shared';
import { z } from 'zod';
import { REJECT_REASON_MIN } from '@/lib/btn-pembiayaan';
import { btnActionSession } from '@/lib/server/data/btn';

/**
 * U04 · Server Action layar pembiayaan BTN (mode presentasi, ADR-0023): validasi pengajuan pencairan piutang,
 * simulasi keputusan BTN, pembayaran BPJS, dan tahap cicilan pasien (penolakan wajib beralasan). Tidak menyimpan
 * apa pun; versi produksi mengirimnya lewat outbox ke BTN dan membentuk jurnal.
 */

export interface FinancingActionResult {
  ok?: true;
  error?: string;
}

const id = z.string().regex(/^[A-Za-z0-9-]{1,40}$/);
const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ajukan-pencairan'),
    batchIds: z.array(id).min(1, 'Pilih minimal satu batch layak bayar.').max(20),
    principal: z.string().regex(/^[1-9]\d{0,15}$/),
  }),
  z.strictObject({ kind: z.literal('pencairan-lanjut'), drawdownId: id }),
  z.strictObject({ kind: z.literal('bayar-bpjs'), drawdownId: id }),
  z.strictObject({ kind: z.literal('cicilan-lanjut'), applicationId: id, stage: z.enum(INSTALMENT_STAGES) }),
  z.strictObject({
    kind: z.literal('cicilan-tolak'),
    applicationId: id,
    reason: z
      .string()
      .trim()
      .min(REJECT_REASON_MIN, `Alasan penolakan wajib, minimal ${REJECT_REASON_MIN} karakter.`)
      .max(300),
  }),
]);
export type FinancingEventInput = z.infer<typeof eventSchema>;

export async function recordFinancingEventAction(input: FinancingEventInput): Promise<FinancingActionResult> {
  const access = await btnActionSession('pembiayaan');
  if ('error' in access) return { error: access.error };
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Isian tidak sah.' };
  // Mode presentasi: divalidasi lalu dibuang (simulasi, tidak disimpan).
  return { ok: true };
}
