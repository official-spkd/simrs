'use client';

import { formatJam, isoDateJakarta, type PaymentOverview, type RefundStage } from '@simrs/shared';
import { useState, useTransition } from 'react';
import { useDemoClock } from '@/components/btn/use-scenario-task';
import {
  applyRefund,
  dayPaidExtra,
  markPaid,
  paymentKpis,
  type Resolution,
  reconTotals,
  resolveRow,
  settleByResolution,
  settleEdc,
  settleEdcTx,
} from '@/lib/btn';
import { type PaymentEventInput, recordPaymentEventAction } from './actions';

/**
 * Keadaan layar pembayaran di atas data server (mode presentasi, tidak disimpan): pelunasan simulasi, penyelesaian
 * pengecualian, settlement EDC saat rekonsiliasi dijalankan, tahap refund, dan mode tersimpan. Data server (termasuk
 * pasien skenario) selalu menjadi dasar, jadi pembaruan dari mesin skenario langsung tampil.
 */
export function usePaymentState(data: PaymentOverview, userName: string) {
  const clock = useDemoClock(data.asOf);
  const [pending, startTransition] = useTransition();
  const [paid, setPaid] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [reconRunAt, setReconRunAt] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [refundStages, setRefundStages] = useState<Record<string, RefundStage>>({});
  /** Jam dana refund kembali ke pasien (memperbarui transaksi asal di tab Transaksi). */
  const [refundDoneAt, setRefundDoneAt] = useState<Record<string, string>>({});
  /** Jam webhook terakhir yang diterima di layar ini (kepala layar). */
  const [lastWebhookAt, setLastWebhookAt] = useState<string | null>(null);
  const [savedMode, setSavedMode] = useState(data.config.mode);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const rows = data.recon.rows.map((r) => {
    const res = resolutions[r.id];
    const row = res ? resolveRow(r, res) : r;
    return reconRunAt ? settleEdc(row) : row;
  });
  const txs = data.transactions.map((t) => {
    let tx = paid[t.id] ? markPaid(t, paid[t.id] ?? data.asOf, `evt-sim-${t.id}`) : t;
    for (const r of rows) tx = settleByResolution(tx, r);
    tx = settleEdcTx(tx, reconRunAt);
    for (const rf of data.refunds) tx = applyRefund(tx, rf, refundDoneAt[rf.id] ?? null);
    return tx;
  });
  // Angka "hari ini" hanya memuat kejadian pada hari layar (pasien skenario berjalan di 12–14 Okt).
  const today = isoDateJakarta(data.asOf);
  const localPaid = new Set(Object.keys(paid));
  const extra = dayPaidExtra(txs, localPaid, today);
  const totals = reconTotals(BigInt(data.day.recorded), rows, BigInt(data.day.edcUnsettled), extra);
  const kpis = paymentKpis(data.day, txs, localPaid, totals, today);

  /** Kirim ke Server Action (validasi saja); umpan balik "(simulasi, tidak disimpan)". */
  const record = (input: PaymentEventInput, label: string): Promise<boolean> =>
    new Promise((resolve) => {
      startTransition(async () => {
        const r = await recordPaymentEventAction(input);
        if (r.error) {
          setMsg({ text: r.error, ok: false });
          resolve(false);
          return;
        }
        setMsg({ text: `${label} · ${formatJam(clock())} (simulasi, tidak disimpan)`, ok: true });
        resolve(true);
      });
    });

  const simulatePay = async (txId: string) => {
    if (
      await record({ kind: 'bayar-simulasi', transactionId: txId }, 'Webhook TPDI diterima, tagihan lunas')
    ) {
      const at = clock();
      setPaid((cur) => ({ ...cur, [txId]: at }));
      setLastWebhookAt(at);
    }
  };

  const resolve = async (rowId: string, actionId: string, note: string) => {
    if (
      await record({ kind: 'pengecualian', rowId, actionId, note }, 'Pengecualian rekonsiliasi ditangani')
    ) {
      const at = clock();
      setResolutions((cur) => ({ ...cur, [rowId]: { actionId, note, at, by: userName } }));
      if (actionId === 'ulang') setLastWebhookAt(at);
    }
  };

  const runRecon = async (): Promise<boolean> => {
    if (!(await record({ kind: 'rekonsiliasi' }, 'Rekonsiliasi dijalankan'))) return false;
    const at = clock();
    const left = rows.filter((r) => r.exception && !r.exception.resolution).length;
    setReconRunAt(at);
    setFlash(
      `Rekonsiliasi dijalankan ${formatJam(at)}: mutasi BTN ditarik ulang lewat H2H, settlement EDC cocok · ${
        left ? `${left} pengecualian masih perlu tindakan.` : 'tidak ada pengecualian tersisa.'
      }`,
    );
    return true;
  };

  return {
    clock,
    pending,
    msg,
    txs,
    rows,
    totals,
    kpis,
    reconRunAt,
    flash,
    refundStages,
    setRefundStage: (id: string, stage: RefundStage) => {
      setRefundStages((cur) => ({ ...cur, [id]: stage }));
      if (stage === 'dana-kembali') {
        const at = clock();
        setRefundDoneAt((cur) => ({ ...cur, [id]: at }));
        setLastWebhookAt(at); // webhook refund.completed dari TPDI
      }
    },
    lastWebhookAt: lastWebhookAt ?? data.connection.lastWebhookAt,
    savedMode,
    setSavedMode,
    record,
    simulatePay,
    resolve,
    runRecon,
  };
}
