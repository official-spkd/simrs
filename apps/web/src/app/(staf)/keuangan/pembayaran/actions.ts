'use server';

import { CONNECTION_MODES, REFUND_REASONS, REFUND_STAGES } from '@simrs/shared';
import { z } from 'zod';
import {
  canSimulatePay,
  REFUND_NOTE_MIN,
  refundApproveError,
  refundSubmitError,
  RESOLUTION_NOTE_MIN,
  resolutionError,
} from '@/lib/btn';
import { btnActionSession, getPaymentOverview } from '@/lib/server/data/btn';
import type { SessionView } from '@/lib/session-view';

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
  const error = await serverCheck(access.session, parsed.data);
  if (error) return { error };
  // Mode presentasi: divalidasi lalu dibuang (simulasi, tidak disimpan).
  return { ok: true };
}

/**
 * Aturan yang tidak boleh dipercayakan ke layar: baris/refund/tagihan dicari lewat pintu data yang sama dengan
 * halaman, lalu diperiksa dengan fungsi murni yang sama (nominal ≤ batas, refund masih draf, tindakan milik baris).
 */
async function serverCheck(session: SessionView, e: PaymentEventInput): Promise<string | null> {
  const load = async () => (await getPaymentOverview(session)).data;
  switch (e.kind) {
    case 'bayar-simulasi': {
      const tx = (await load()).transactions.find((t) => t.id === e.transactionId);
      return tx && canSimulatePay(tx) ? null : 'Tagihan ini tidak bisa dilunasi lewat simulasi.';
    }
    case 'pengecualian': {
      const row = (await load()).recon.rows.find((r) => r.id === e.rowId);
      return row ? resolutionError(row, e.actionId, e.note) : 'Baris rekonsiliasi tidak ditemukan.';
    }
    case 'refund-ajukan': {
      const refund = (await load()).refunds.find((r) => r.id === e.refundId);
      return refundSubmitError(refund, BigInt(e.amount), e.reason, e.note);
    }
    case 'refund-setujui': {
      const refund = (await load()).refunds.find((r) => r.id === e.refundId);
      return refundApproveError(refund, e.stage);
    }
    default:
      return null;
  }
}
