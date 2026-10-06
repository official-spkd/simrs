'use client';

import { formatJam, formatRupiah, type PaymentMethod, PAYMENT_METHODS } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useId, useState, useTransition } from 'react';
import { kasirAction, type ManualLineInput } from '@/app/(staf)/keuangan/kasir/actions';
import { REKENING } from '@/lib/demo/fixtures/rs';
import { cashChange, digitsToRupiah, instalmentOptions, PAYMENT_METHOD_LABEL } from '@/lib/keuangan';
import { ChoiceCards } from './choice-cards';
import { CicilanBox } from './cicilan-box';
import { CashBox, DebitBox, QrisBox, TransferBox, VaBox } from './payment-methods';

const NEXT = [
  '',
  'Simulasikan: BTN memverifikasi data',
  'Simulasikan: BTN menyetujui',
  'Simulasikan: pasien tanda tangan akad (TTE)',
  'Simulasikan: BTN mencairkan dana ke RS',
];

export interface PaidInfo {
  method: PaymentMethod;
  at: string;
  note: string;
  message: string;
}

/** Metode pembayaran pasien (mockup Kasir) untuk tagihan biasa; tombol selesai digerbang per metode. */
export function PaymentPanel({
  invoiceId,
  receiptNo,
  due,
  manual,
  final,
  onPaid,
}: {
  invoiceId: string;
  /** Nomor kuitansi untuk tampilan (VA); server menurunkannya sendiri dari tagihan. */
  receiptNo: string;
  due: bigint;
  /** Item manual di layar: server menghitung ulang sisa tagihan dan menolak nominal yang tidak cocok. */
  manual: readonly ManualLineInput[];
  /** Tagihan sudah difinalkan (terkunci). */
  final: boolean;
  onPaid: (p: PaidInfo) => void;
}) {
  const id = useId();
  const [method, setMethod] = useState<PaymentMethod>('qris');
  const [qrisAt, setQrisAt] = useState<string | null>(null);
  const [vaAt, setVaAt] = useState<string | null>(null);
  const [edcOk, setEdcOk] = useState(false);
  const [cash, setCash] = useState('');
  const [ref, setRef] = useState('');
  const [refOk, setRefOk] = useState(false);
  const [tenor, setTenor] = useState<string | null>(null);
  const [cicil, setCicil] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const now = () => formatJam(new Date());
  const received = digitsToRupiah(cash);
  const fmt = (v: bigint) => formatRupiah(v);

  const gate: Record<PaymentMethod, [boolean, string]> = {
    qris: [!!qrisAt, 'Menunggu pembayaran QRIS diterima.'],
    va: [!!vaAt, 'Menunggu webhook TPDI bahwa VA BTN sudah dibayar.'],
    debit: [edcOk, 'Menunggu struk EDC approved.'],
    tunai: [
      cashChange(due, received).enough,
      cash
        ? `Uang diterima kurang ${fmt(cashChange(due, received).short)}.`
        : 'Isi jumlah uang yang diterima.',
    ],
    transfer: [
      ref.trim().length >= 6 && refOk,
      'Isi nomor referensi (min. 6 karakter) dan cocokkan dengan mutasi BTN.',
    ],
    cicilan: [
      cicil.length >= 5,
      cicil.length === 0
        ? tenor
          ? 'Ajukan cicilan ke BTN terlebih dulu.'
          : 'Pilih tenor lalu ajukan ke BTN.'
        : 'Menunggu dana cair dari BTN ke rekening RS.',
    ],
  };
  const [ready, why] = final
    ? gate[method]
    : [false, 'Finalkan tagihan dulu; tagihan berjalan belum bisa dibayar.'];
  const note: Record<PaymentMethod, string> = {
    qris: `QRIS via TPDI ${fmt(due)} · masuk BTN ${REKENING.operasional}`,
    va: `VA BTN ${fmt(due)} · lunas via webhook TPDI`,
    debit: `Debit/kredit EDC BTN ${fmt(due)} · approval tercatat`,
    tunai: `Tunai ${fmt(received)} · kembalian ${fmt(cashChange(due, received).change)}`,
    transfer: `Transfer bank ${fmt(due)} · ref ${ref.trim()}`,
    cicilan: `Cicilan BTN ${tenor ?? '-'} bulan · dana ${fmt(due)} cair dari BTN ke ${REKENING.operasional}`,
  };

  const finish = () =>
    startTransition(async () => {
      const r = await kasirAction({
        type: 'bayar',
        invoiceId,
        method,
        amount: due.toString(),
        manual: [...manual],
      });
      if (!r.ok) return setError(r.message);
      onPaid({ method, at: r.at ?? now(), note: note[method], message: r.message });
    });

  const locked = cicil.length > 0;
  return (
    <div className="flex flex-col gap-3">
      <ChoiceCards
        legend="Metode pembayaran"
        className="grid grid-cols-2 gap-2"
        value={method}
        onChange={setMethod}
        options={PAYMENT_METHODS.map((m) => ({
          id: m,
          label: PAYMENT_METHOD_LABEL[m].name,
          sub: PAYMENT_METHOD_LABEL[m].sub,
          disabled: locked && method !== m,
          className: m === 'cicilan' || m === 'transfer' ? 'col-span-2' : undefined,
        }))}
      />
      {method === 'qris' && <QrisBox due={due} paidAt={qrisAt} onSimulate={() => setQrisAt(now())} />}
      {method === 'va' && (
        <VaBox
          due={due}
          vaNumber={`8808 0127 ${receiptNo.slice(3, 7)} ${receiptNo.slice(-4)}`}
          paidAt={vaAt}
          onSimulate={() => setVaAt(now())}
        />
      )}
      {method === 'debit' && <DebitBox due={due} ok={edcOk} onToggle={() => setEdcOk((v) => !v)} />}
      {method === 'tunai' && <CashBox due={due} cash={cash} onCash={setCash} />}
      {method === 'transfer' && (
        <TransferBox
          reference={ref}
          verified={refOk}
          onReference={setRef}
          onVerified={() => setRefOk((v) => !v)}
        />
      )}
      {method === 'cicilan' && (
        <CicilanBox
          due={due}
          tenors={instalmentOptions(due)}
          tenor={tenor}
          onTenor={locked ? undefined : setTenor}
          submit={
            locked
              ? null
              : {
                  label: 'Ajukan pembiayaan ke BTN',
                  enabled: !!tenor,
                  reason: tenor ? '' : 'Pilih tenor terlebih dulu.',
                  onClick: () => setCicil([now()]),
                }
          }
          done={cicil.length}
          times={cicil}
          next={
            cicil.length >= 1 && cicil.length < 5
              ? {
                  label: NEXT[cicil.length] ?? '',
                  enabled: true,
                  reason: '',
                  onClick: () => setCicil((c) => [...c, now()]),
                }
              : null
          }
        />
      )}
      <button
        type="button"
        disabled={!ready || pending}
        aria-describedby={`${id}-alasan`}
        onClick={finish}
        className={cx(
          'min-h-12 rounded-control font-[inherit] font-semibold',
          ready
            ? 'cursor-pointer border border-brand-800 bg-brand-600 text-white'
            : 'cursor-not-allowed border border-line-strong bg-[#E9EDF1] text-ink-500',
        )}
      >
        Selesaikan dan cetak kuitansi
      </button>
      <span id={`${id}-alasan`} role="status" className="text-center text-small font-medium text-warning">
        {ready ? '' : why}
      </span>
      {error && (
        <span role="alert" className="text-caption text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
