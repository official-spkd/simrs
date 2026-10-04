'use server';

import { CONNECTION_MODES, REFUND_REASONS, REFUND_STAGES } from '@simrs/shared';
import { z } from 'zod';
import { REFUND_NOTE_MIN, RESOLUTION_NOTE_MIN } from '@/lib/btn';
import { btnActionSession } from '@/lib/server/data/btn';

/**
 * I05/U09 · Server Action layar pembayaran digital (mode presentasi, ADR-0023): validasi pelunasan simulasi,
 * penyelesaian pengecualian rekonsiliasi (catatan wajib), refund berjenjang, dan konfigurasi kanal. Tidak menyimpan
 * apa pun; versi produksi mencatat semuanya di jejak audit dan membentuk jurnal.
 */

export interface PaymentActionResult {
  ok?: true;
  error?: string;
}

const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('bayar-simulasi'), transactionId: id }),
  z.strictObject({
    kind: z.literal('pengecualian'),
    rowId: id,
    actionId: id,
    note: z
      .string()
      .trim()
      .min(RESOLUTION_NOTE_MIN, `Catatan penyelesaian wajib, minimal ${RESOLUTION_NOTE_MIN} karakter.`)
      .max(300),
  }),
  z.strictObject({ kind: z.literal('rekonsiliasi') }),
  z.strictObject({
    kind: z.literal('refund-ajukan'),
    refundId: id,
    amount: z.string().regex(/^[1-9]\d{0,12}$/, 'Nominal refund tidak sah.'),
    reason: z.enum(REFUND_REASONS),
    note: z
      .string()
      .trim()
      .min(REFUND_NOTE_MIN, `Keterangan wajib, minimal ${REFUND_NOTE_MIN} karakter.`)
      .max(300),
  }),
  z.strictObject({ kind: z.literal('refund-setujui'), refundId: id, stage: z.enum(REFUND_STAGES) }),
  z
    .strictObject({
      kind: z.literal('konfigurasi'),
      channels: z.strictObject({
        va: z.boolean(),
        qris: z.boolean(),
        edc: z.boolean(),
        cicilan: z.boolean(),
      }),
      vaExpiry: z.enum(['12', '24', '48']),
      qrisExpiry: z.enum(['5', '10', '15']),
      mode: z.enum(CONNECTION_MODES),
    })
    .refine((c) => Object.values(c.channels).some(Boolean), 'Minimal satu kanal pembayaran harus aktif.'),
  z.strictObject({ kind: z.literal('rotasi-secret') }),
]);
export type PaymentEventInput = z.infer<typeof eventSchema>;

export async function recordPaymentEventAction(input: PaymentEventInput): Promise<PaymentActionResult> {
  const access = await btnActionSession('pembayaran');
  if ('error' in access) return { error: access.error };
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Isian tidak sah.' };
  // Mode presentasi: divalidasi lalu dibuang (simulasi, tidak disimpan).
  return { ok: true };
}
