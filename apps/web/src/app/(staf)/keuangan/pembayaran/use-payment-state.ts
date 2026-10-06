'use client';

import { isoDateJakarta, type PaymentOverview } from '@simrs/shared';
import { useCallback, useState } from 'react';
import { useDemoClock } from '@/components/btn/use-scenario-task';
import { paymentKpis, reconTotals, dayPaidExtra } from '@/lib/btn';
import { useStoreAction } from '@/lib/demo/store/client';
import { type PaymentEventInput, recordPaymentEventAction } from './actions';

/** Bentuk masukan aksi tanpa revisi (revisi terkini ditambahkan hook). */
export type PaymentInput = PaymentEventInput extends infer E
  ? E extends unknown
    ? Omit<E, 'rev'>
    : never
  : never;

/**
 * Keadaan layar pembayaran di atas data server yang sudah memuat toko demo (domain `pembayaran-btn`, ADR-0085):
 * pelunasan simulasi, penyelesaian pengecualian, rekonsiliasi, tahap refund, dan konfigurasi tersimpan di server dan
 * tampil lagi setelah muat ulang. Hook ini hanya menghitung KPI dan mengirim aksi dengan revisi terkini.
 */
export function usePaymentState(
  data: PaymentOverview,
  opts: { rev: number; localPaid: readonly string[]; reconRunAt: string | null; flash: string | null },
) {
  const clock = useDemoClock(data.asOf);
  const { run, pending } = useStoreAction(opts.rev);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const rows = data.recon.rows;
  const txs = data.transactions;
  // Angka "hari ini" hanya memuat kejadian pada hari layar (pasien skenario berjalan di 12–14 Okt).
  const today = isoDateJakarta(data.asOf);
  const localPaid = new Set(opts.localPaid);
  const extra = dayPaidExtra(txs, localPaid, today);
  const totals = reconTotals(BigInt(data.day.recorded), rows, BigInt(data.day.edcUnsettled), extra);
  const kpis = paymentKpis(data.day, txs, localPaid, totals, today);

  /** Kirim ke Server Action (tersimpan di toko demo); true bila diterima. */
  const record = useCallback(
    (input: PaymentInput, _label?: string): Promise<boolean> =>
      new Promise((resolve) => {
        run(
          async (r) => {
            const res = await recordPaymentEventAction({ ...input, rev: r } as PaymentEventInput);
            return { ...res, ok: !!res.ok };
          },
          (res) => {
            setMsg(
              res.ok
                ? { text: res.message ?? 'Tersimpan', ok: true }
                : { text: res.error ?? 'Ditolak.', ok: false },
            );
            resolve(res.ok);
          },
        );
      }),
    [run],
  );

  return {
    clock,
    pending,
    msg,
    txs,
    rows,
    totals,
    kpis,
    reconRunAt: opts.reconRunAt,
    flash: opts.flash,
    lastWebhookAt: data.connection.lastWebhookAt,
    savedMode: data.config.mode,
    record,
    simulatePay: (txId: string) => record({ kind: 'bayar-simulasi', transactionId: txId }),
    resolve: (rowId: string, actionId: string, note: string) =>
      record({ kind: 'pengecualian', rowId, actionId, note }),
    runRecon: () => record({ kind: 'rekonsiliasi' }),
  };
}
