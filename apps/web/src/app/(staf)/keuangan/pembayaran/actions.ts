'use server';

import { CONNECTION_MODES, formatJam, REFUND_REASONS, REFUND_STAGES } from '@simrs/shared';
import { z } from 'zod';
import {
  canSimulatePay,
  REFUND_NOTE_MIN,
  refundApproveError,
  refundSubmitError,
  RESOLUTION_NOTE_MIN,
  resolutionError,
} from '@/lib/btn';
import {
  exceptionJournal,
  pendingReconKeys,
  refundDoneJournal,
  refundSodProblem,
  simulatedPaymentJournal,
} from '@/lib/btn-pembayaran-toko';
import { STATIC_INVOICES } from '@/lib/demo/fixtures/keuangan';
import type { EventOf } from '@/lib/demo/store/registry';
import { btnActionSession, getPaymentOverview } from '@/lib/server/data/btn';
import { demoStamp, periodLock } from '@/lib/server/data/keuangan-toko';
import { commitEvent, demoActor } from '@/lib/server/demo/state';

/**
 * I05/U09 · Server Action layar pembayaran digital (mode presentasi, ADR-0023/0085): pelunasan simulasi (webhook
 * TPDI), penyelesaian pengecualian rekonsiliasi (catatan wajib), rekonsiliasi 3 arah, refund berjenjang (pembuat ≠
 * penyetuju dari id pengguna sesi), dan konfigurasi kanal. Aksi tersimpan di domain toko `pembayaran-btn`; mutasi uang
 * membawa jurnal otomatis ke Akuntansi. Baris/refund/tagihan dicari lewat pintu data yang sama dengan halaman.
 */

export interface PaymentActionResult {
  ok?: true;
  error?: string;
  message?: string;
  stale?: boolean;
}

const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
const rev = z.number().int().min(0);
const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('bayar-simulasi'), transactionId: id, rev }),
  z.strictObject({
    kind: z.literal('pengecualian'),
    rowId: id,
    actionId: id,
    note: z
      .string()
      .trim()
      .min(RESOLUTION_NOTE_MIN, `Catatan penyelesaian wajib, minimal ${RESOLUTION_NOTE_MIN} karakter.`)
      .max(300),
    rev,
  }),
  z.strictObject({ kind: z.literal('rekonsiliasi'), rev }),
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
    rev,
  }),
  z.strictObject({ kind: z.literal('refund-setujui'), refundId: id, stage: z.enum(REFUND_STAGES), rev }),
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
      rev,
    })
    .refine((c) => Object.values(c.channels).some(Boolean), 'Minimal satu kanal pembayaran harus aktif.'),
  z.strictObject({ kind: z.literal('rotasi-secret'), rev }),
]);
export type PaymentEventInput = z.infer<typeof eventSchema>;

/** Nomor invoice yang ada di antrean Kasir: dilunasi di Kasir, bukan lewat simulasi webhook di layar ini. */
const KASIR_INVOICES = new Set(STATIC_INVOICES.map((i) => i.number));

export async function recordPaymentEventAction(input: PaymentEventInput): Promise<PaymentActionResult> {
  const access = await btnActionSession('pembayaran');
  if ('error' in access) return { error: access.error };
  const s = access.session;
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Isian tidak sah.' };
  const e = parsed.data;
  const at = demoStamp();
  const { data, state } = await getPaymentOverview(s);
  const commit = async (event: EventOf<'pembayaran-btn'>, message: string): Promise<PaymentActionResult> => {
    const r = await commitEvent('pembayaran-btn', event, { rev: e.rev, session: s });
    return r.ok ? { ok: true, message: `${message} · ${formatJam(at)}` } : { error: r.error, stale: r.stale };
  };
  switch (e.kind) {
    case 'bayar-simulasi': {
      const tx = data.transactions.find((t) => t.id === e.transactionId);
      if (!tx || !canSimulatePay(tx)) return { error: 'Tagihan ini tidak bisa dilunasi lewat simulasi.' };
      if (KASIR_INVOICES.has(tx.invoiceNo)) {
        return { error: `Tagihan ${tx.invoiceNo} ada di antrean Kasir; lunasi dari layar Kasir.` };
      }
      const lock = await periodLock(at);
      if (lock) return { error: lock };
      return commit(
        {
          type: 'bayar-simulasi',
          transactionId: tx.id,
          invoiceNo: tx.invoiceNo,
          at,
          jurnal: [simulatedPaymentJournal(tx)],
        },
        'Webhook TPDI diterima, tagihan lunas · jurnal menunggu rekonsiliasi',
      );
    }
    case 'pengecualian': {
      const row = data.recon.rows.find((r) => r.id === e.rowId);
      const err = row ? resolutionError(row, e.actionId, e.note) : 'Baris rekonsiliasi tidak ditemukan.';
      if (err || !row) return { error: err ?? 'Baris rekonsiliasi tidak ditemukan.' };
      const j = exceptionJournal(row, e.actionId);
      if (j) {
        const lock = await periodLock(at);
        if (lock) return { error: lock };
      }
      return commit(
        { type: 'pengecualian', rowId: row.id, actionId: e.actionId, note: e.note, at, jurnal: j ? [j] : [] },
        `Pengecualian rekonsiliasi ditangani${j ? ' · jurnal terbentuk' : ''}`,
      );
    }
    case 'rekonsiliasi': {
      const keys = pendingReconKeys(state);
      return commit(
        { type: 'rekonsiliasi', reconKeys: keys, at },
        `Rekonsiliasi dijalankan: mutasi BTN ditarik ulang lewat H2H · ${keys.length} transaksi cocok 3 arah, jurnal terposting`,
      );
    }
    case 'refund-ajukan': {
      const refund = data.refunds.find((r) => r.id === e.refundId);
      const err = refundSubmitError(refund, BigInt(e.amount), e.reason, e.note);
      if (err) return { error: err };
      return commit(
        { type: 'refund-ajukan', refundId: e.refundId, amount: e.amount, reason: e.reason, note: e.note, at },
        `${refund?.number ?? 'Refund'} diajukan oleh ${s.user.displayName}`,
      );
    }
    case 'refund-setujui': {
      const refund = data.refunds.find((r) => r.id === e.refundId);
      const err =
        refundApproveError(refund, e.stage) ?? refundSodProblem(state, e.refundId, e.stage, demoActor(s));
      if (err || !refund) return { error: err ?? 'Refund tidak ditemukan.' };
      if (refund.stage !== e.stage)
        return { error: 'Tahap refund ini sudah lewat; muat ulang.', stale: true };
      const done = e.stage === 'diproses-btn';
      if (done) {
        const lock = await periodLock(at);
        if (lock) return { error: lock };
      }
      return commit(
        {
          type: 'refund-setujui',
          refundId: refund.id,
          stage: e.stage,
          at,
          jurnal: done ? [refundDoneJournal(refund)] : [],
        },
        done
          ? `${refund.number}: dana diterima pasien · jurnal refund terbentuk`
          : `${refund.number}: disetujui ${s.user.displayName}`,
      );
    }
    case 'konfigurasi':
      return commit(
        {
          type: 'konfigurasi',
          channels: e.channels,
          vaExpiry: e.vaExpiry,
          qrisExpiry: e.qrisExpiry,
          mode: e.mode,
          at,
        },
        `Konfigurasi kanal disimpan oleh ${s.user.displayName} · tercatat di jejak audit`,
      );
    case 'rotasi-secret':
      return commit({ type: 'rotasi-secret', at }, `Secret webhook dirotasi oleh ${s.user.displayName}`);
  }
}
