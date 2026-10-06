'use client';

import { type AccountingBoard, formatRupiah, formatTanggalWaktu } from '@simrs/shared';
import { Button, Chip, type ChipTone, cx, Field } from '@simrs/ui';
import Link from 'next/link';
import { useState } from 'react';
import { digitsToRupiah } from '@/lib/keuangan';
import { agingView, formatJuta } from '@/lib/keuangan-akuntansi';
import { labelPeriode, periodeOf, PERIODE_TERTUTUP, tanggalPendek } from '@/lib/keuangan-jurnal';
import {
  AGING_LABEL,
  agingBucket,
  type BatchTagihan,
  batchPaid,
  batchProblem,
  batchRemaining,
  batchTotal,
  outstanding,
  paymentJournal,
  paymentLocked,
  paymentProblem,
  type PiutangItem,
} from '@/lib/keuangan-piutang';
import { JurnalPasangan } from './jurnal-pasangan';

const BATCH_STATUS: Record<BatchTagihan['status'], { label: string; tone: ChipTone }> = {
  draf: { label: 'Draf', tone: 'neutral' },
  ditagih: { label: 'Ditagih', tone: 'info' },
  sebagian: { label: 'Dibayar sebagian', tone: 'warning' },
  lunas: { label: 'Lunas', tone: 'success' },
};
type Group = AccountingBoard['aging'][number]['payer'];

/**
 * Umur piutang per penjamin (angka sama dengan Akuntansi), daftar piutang contoh per penjamin, batch penagihan
 * (satu penjamin per batch), dan pelunasan bereferensi dengan jurnal Dr bank / Cr piutang. Pembayaran bertanggal
 * periode tertutup dikunci.
 */
export function PiutangPenagihan({
  aging,
  items,
  batches,
  today,
  onCreateBatch,
  onSend,
  onPay,
}: {
  aging: AccountingBoard['aging'];
  items: readonly PiutangItem[];
  batches: readonly BatchTagihan[];
  today: string;
  onCreateBatch: (ids: string[]) => void;
  onSend: (number: string) => void;
  onPay: (number: string, amount: bigint, reference: string) => void;
}) {
  const [group, setGroup] = useState<Group>('asuransi');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState<string | null>(null);
  const [amountRaw, setAmountRaw] = useState('');
  const [reference, setReference] = useState('');
  const shown = items.filter((i) => i.payerGroup === group);
  const selected = shown.filter((i) => picked.has(i.id));
  const problem = batchProblem(selected);
  const groupBatches = batches.filter((b) => b.payerGroup === group);

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Umur piutang per penjamin"
        className="rounded-card border border-white/95 bg-white/90 shadow-card"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
          <span className="font-semibold">Umur piutang per penjamin (Rp juta)</span>
          <span className="text-caption text-ink-500">
            Dihitung dari tanggal invoice · sama dengan layar Akuntansi
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-caption text-ink-500">
                <th scope="col" className="px-4 py-2 font-semibold">
                  Penjamin
                </th>
                {AGING_LABEL.map((l) => (
                  <th key={l} scope="col" className="py-2 pr-3 text-right font-semibold">
                    {l}
                  </th>
                ))}
                <th scope="col" className="py-2 pr-4 text-right font-semibold">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {aging.map((r) => {
                const v = agingView(r);
                const on = r.payer === group;
                return (
                  <tr
                    key={r.payer}
                    className={cx(
                      'border-t border-line',
                      on
                        ? 'bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]'
                        : 'hover:bg-brand-50/60',
                    )}
                  >
                    <td className="px-4 py-1.5">
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setGroup(r.payer);
                          setPicked(new Set());
                        }}
                        className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] font-semibold text-brand-700"
                      >
                        {r.label}
                      </button>
                    </td>
                    {v.amounts.map((a, i) => (
                      <td
                        key={AGING_LABEL[i]}
                        className={cx('py-1.5 pr-3 text-right font-mono', i === 3 && a > 0n && 'text-danger')}
                      >
                        {formatJuta(a)} <span className="text-caption text-ink-500">({v.shares[i]}%)</span>
                      </td>
                    ))}
                    <td className="py-1.5 pr-4 text-right font-mono font-semibold">{formatJuta(v.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {group === 'bpjs' ? (
        <p className="m-0 rounded-card border border-white/95 bg-white/90 shadow-card p-4 text-small text-ink-700">
          Piutang BPJS ditagih lewat klaim INA-CBG per berkas, bukan batch penagihan.{' '}
          <Link href="/keuangan/klaim" className="font-semibold">
            Buka Klaim & koding
          </Link>{' '}
          untuk status berkas, atau{' '}
          <Link href="/keuangan/pembiayaan" className="font-semibold">
            Pembiayaan BTN
          </Link>{' '}
          untuk piutang layak bayar yang dijaminkan.
        </p>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          <section
            aria-label="Daftar piutang"
            className="flex min-w-0 flex-[999_1_520px] flex-col overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <span className="flex flex-col">
                <span className="font-semibold">
                  Piutang terbuka · {aging.find((a) => a.payer === group)?.label}
                </span>
                <span className="text-caption text-ink-500">
                  Contoh per invoice; centang untuk membuat batch penagihan
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <Button
                  variant="primary"
                  disabled={!!problem}
                  aria-describedby={problem ? 'batch-gate' : undefined}
                  onClick={() => {
                    onCreateBatch(selected.map((s) => s.id));
                    setPicked(new Set());
                  }}
                >
                  Buat batch penagihan
                </Button>
                {problem && (
                  <span id="batch-gate" className="text-caption font-medium text-warning">
                    {problem}
                  </span>
                )}
              </span>
            </div>
            <ul aria-label="Piutang" className="m-0 flex list-none flex-col p-0">
              {shown.map((i) => {
                const bucket = agingBucket(i.invoiceDate, today);
                const left = outstanding(i);
                return (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
                    <input
                      type="checkbox"
                      id={`pi-${i.id}`}
                      checked={picked.has(i.id)}
                      disabled={!!i.batch || left === 0n}
                      onChange={() =>
                        setPicked((cur) => {
                          const next = new Set(cur);
                          if (next.has(i.id)) next.delete(i.id);
                          else next.add(i.id);
                          return next;
                        })
                      }
                      className="size-5 accent-brand-700"
                    />
                    <label htmlFor={`pi-${i.id}`} className="flex min-w-0 flex-[1_1_220px] flex-col">
                      <span className="font-semibold">
                        {i.patient} · <span className="font-mono text-caption">{i.invoiceNo}</span>
                      </span>
                      <span className="text-caption text-ink-500">
                        {i.payerName} · invoice {tanggalPendek(i.invoiceDate)} · {AGING_LABEL[bucket]}
                      </span>
                    </label>
                    <span className="flex flex-col items-end">
                      <span className="font-mono font-semibold">{formatRupiah(left)}</span>
                      <span className="text-caption text-ink-500">
                        {i.batch ? `dalam ${i.batch}` : left === 0n ? 'lunas' : 'belum ditagih'}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section
            aria-label="Batch penagihan"
            className="flex min-w-0 flex-[1_1_360px] flex-col gap-3 xl:max-w-[480px]"
          >
            {groupBatches.length === 0 && (
              <p className="m-0 rounded-card border border-white/95 bg-white/90 shadow-card p-4 text-small text-ink-500">
                Belum ada batch penagihan untuk penjamin ini.
              </p>
            )}
            {groupBatches.map((b) => {
              const total = batchTotal(b, items);
              const paid = batchPaid(b);
              const remaining = batchRemaining(b, items);
              const st = BATCH_STATUS[b.status];
              const amount = digitsToRupiah(amountRaw);
              const payProblem = paymentProblem(remaining, amount, reference);
              return (
                <article
                  key={b.number}
                  aria-label={`Batch ${b.number}`}
                  className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      <span className="font-mono">{b.number}</span> · {b.payerName}
                    </span>
                    <Chip tone={st.tone}>{st.label}</Chip>
                  </span>
                  <span className="text-caption text-ink-500">
                    {b.itemIds.length} invoice ·{' '}
                    {b.sentAt ? `dikirim ${formatTanggalWaktu(b.sentAt)}` : 'belum dikirim'}
                  </span>
                  <dl className="m-0 grid grid-cols-3 gap-2 text-small">
                    {(
                      [
                        ['Ditagih', total],
                        ['Dibayar', paid],
                        ['Sisa', remaining],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k} className="flex flex-col">
                        <dt className="text-caption text-ink-500">{k}</dt>
                        <dd className="m-0 font-mono font-semibold" data-batch-field={k}>
                          {formatRupiah(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {b.payments.length > 0 && (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-caption">
                      {b.payments.map((p) => {
                        const locked = paymentLocked(p, PERIODE_TERTUTUP);
                        return (
                          <li
                            key={p.id}
                            className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-1"
                          >
                            <span className="text-ink-700">
                              {formatTanggalWaktu(p.at)} · {formatRupiah(p.amount)} · ref {p.reference}
                            </span>
                            {locked ? (
                              <span className="font-medium text-ink-500">
                                Terkunci: periode {labelPeriode(periodeOf(p.at))} ditutup; koreksi lewat
                                penyesuaian
                              </span>
                            ) : (
                              <span className="text-success">Terposting</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {b.status === 'draf' && (
                    <Button variant="primary" onClick={() => onSend(b.number)}>
                      Kirim tagihan ke penjamin
                    </Button>
                  )}
                  {(b.status === 'ditagih' || b.status === 'sebagian') &&
                    (paying === b.number ? (
                      <form
                        aria-label={`Pelunasan ${b.number}`}
                        className="flex flex-col gap-2 rounded-control border border-brand-600 bg-brand-50 p-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (payProblem) return;
                          onPay(b.number, amount, reference.trim());
                          setPaying(null);
                          setAmountRaw('');
                          setReference('');
                        }}
                      >
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Field
                            label="Nominal diterima (Rp)"
                            inputMode="numeric"
                            value={amountRaw}
                            onChange={(e) => setAmountRaw(e.target.value)}
                            hint={`sisa ${formatRupiah(remaining)}`}
                            hintTone="muted"
                          />
                          <Field
                            label="Referensi mutasi bank"
                            value={reference}
                            onChange={(e) => setReference(e.target.value)}
                            placeholder="mis. BTN-H2H-2610-90311"
                          />
                        </div>
                        {amount > 0n && amount <= remaining && (
                          <JurnalPasangan
                            jurnal={paymentJournal(b, amount)}
                            status="diposting saat disimpan"
                          />
                        )}
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={cx(
                              'text-caption',
                              payProblem ? 'font-medium text-warning' : 'text-success',
                            )}
                          >
                            {payProblem ?? 'Siap diposting.'}
                          </span>
                          <span className="flex gap-2">
                            <Button type="button" variant="ghost" onClick={() => setPaying(null)}>
                              Batal
                            </Button>
                            <Button type="submit" variant="primary" disabled={!!payProblem}>
                              Posting pelunasan
                            </Button>
                          </span>
                        </span>
                      </form>
                    ) : (
                      <Button onClick={() => setPaying(b.number)}>Catat pelunasan…</Button>
                    ))}
                </article>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
}
