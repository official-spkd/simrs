'use client';

import { formatRupiah, type Invoice } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import Link from 'next/link';
import { useId } from 'react';
import type { ManualLineInput } from '@/app/(staf)/keuangan/kasir/actions';
import { REKENING } from '@/lib/demo/fixtures/rs';
import type { ScenarioFlow } from '@/lib/keuangan-flow';
import { type PaidInfo, PaymentPanel } from './payment-panel';
import { ScenarioPayment } from './scenario-payment';

export interface GateAction {
  label: string;
  enabled: boolean;
  reason: string;
  onClick: () => void;
}

function Gate({ action, primary = true }: { action: GateAction; primary?: boolean }) {
  const id = useId();
  return (
    <span className="flex flex-col gap-1">
      <Button
        variant={primary ? 'primary' : 'secondary'}
        disabled={!action.enabled}
        aria-describedby={action.reason ? id : undefined}
        onClick={action.onClick}
        className="min-h-12 w-full"
      >
        {action.label}
      </Button>
      {action.reason && (
        <span id={id} className="text-center text-small font-medium text-warning">
          {action.reason}
        </span>
      )}
    </span>
  );
}

/**
 * Panel pembayaran Kasir (mockup Kasir, kolom kanan): finalkan (mengunci tagihan) → bayar dengan 6 metode, atau
 * tutup kunjungan bila pasien Rp 0 → kuitansi lunas dan cetak.
 */
export function KasirSettlement({
  invoice,
  patientShare,
  due,
  final,
  lunas,
  flow,
  busy,
  receipt,
  manual,
  finalize,
  close,
  discharge,
  onTask,
  onPaid,
  nextHref,
}: {
  invoice: Invoice;
  patientShare: bigint;
  due: bigint;
  final: boolean;
  lunas: boolean;
  flow: ScenarioFlow | null;
  busy: boolean;
  receipt: { no: string; at: string; note: string } | null;
  /** Item manual di layar (dihitung ulang server saat bayar). */
  manual: readonly ManualLineInput[];
  finalize: GateAction;
  close: GateAction;
  /** Tugas skenario setelah lunas (pulangkan pasien), null bila tidak ada. */
  discharge: GateAction | null;
  onTask: (task: string, value: true | string) => void;
  onPaid: (p: PaidInfo) => void;
  nextHref: string | null;
}) {
  const deposit = invoice.payments.filter((p) => p.kind === 'deposit');
  return (
    <section
      aria-label="Pembayaran"
      className="flex flex-col gap-3 rounded-card border border-line bg-white bg-[linear-gradient(160deg,#FFFFFF_60%,rgba(15,118,110,0.06))] p-4"
    >
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">Dibayar pasien</span>
        <span className="font-mono text-[26px] font-bold text-brand-700">{formatRupiah(patientShare)}</span>
      </span>
      <span className="text-[12.5px] text-ink-700">
        {deposit.length > 0
          ? `Deposit masuk ${formatRupiah(deposit.reduce((s, p) => s + BigInt(p.amount), 0n))} · `
          : ''}
        sisa bayar{' '}
        <span className="font-semibold text-ink-900">{lunas ? 'Rp 0 (lunas)' : formatRupiah(due)}</span>
      </span>
      {!final && <Gate action={finalize} />}
      {final && !lunas && due > 0n && flow && (
        <ScenarioPayment flow={flow} due={due} pending={busy} onTask={onTask} />
      )}
      {final && !lunas && due > 0n && !flow && (
        <PaymentPanel
          invoiceId={invoice.id}
          receiptNo={invoice.receiptNo ?? invoice.number.replace('INV', 'KW')}
          due={due}
          manual={manual}
          final={final}
          onPaid={onPaid}
        />
      )}
      {final && !lunas && due === 0n && <Gate action={close} />}
      {lunas && receipt && (
        <div
          role="status"
          className="flex flex-col gap-2.5 rounded-control border border-[#B7DEC0] bg-[#EAF5EC] p-3"
        >
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-success">Lunas</span>
            <span className="text-caption font-semibold text-success">
              kuitansi {receipt.no} · {receipt.at}
            </span>
          </span>
          <span className="text-[12.5px] text-ink-700">{receipt.note}</span>
          <span className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => window.print()}>
              Cetak kuitansi
            </Button>
            {nextHref && (
              <Link
                href={nextHref}
                className="inline-flex min-h-11 items-center rounded-control border border-brand-800 bg-white px-3.5 font-semibold text-brand-700 no-underline"
              >
                Tagihan berikutnya
              </Link>
            )}
          </span>
        </div>
      )}
      {discharge && <Gate action={discharge} primary={false} />}
      <span className={cx('text-center text-caption text-ink-500')}>
        Jurnal otomatis: Kas/Bank BTN {REKENING.operasional} (D) · uang muka/piutang pasien (K) · piutang BPJS
        tetap terbuka sampai klaim dibayar
      </span>
    </section>
  );
}
