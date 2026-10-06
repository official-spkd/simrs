'use client';

import { formatRupiah } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useId } from 'react';
import { cashChange, digitsToRupiah } from '@/lib/keuangan';
import { REKENING } from '@/lib/demo/fixtures/rs';

const BOX =
  'flex flex-col gap-2 rounded-control border border-line bg-[#F8FAFB] p-3 text-[12.5px] text-ink-700';
const SIM_BTN =
  'min-h-11 cursor-pointer rounded-control border border-dashed border-brand-700 bg-white px-3.5 font-[inherit] font-medium text-brand-700 disabled:cursor-not-allowed disabled:opacity-60';

/** Kode QR contoh (dekoratif, simulasi). */
export function QrSample({ faded }: { faded: boolean }) {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 9 9"
      role="img"
      aria-label="Contoh kode QR (simulasi)"
      className={cx('flex-none', faded && 'opacity-35')}
    >
      <rect width="9" height="9" fill="#FFFFFF" />
      <path d="M0 0h3v3H0zM6 0h3v3H6zM0 6h3v3H0z" fill="#14212B" />
      <path d="M1 1h1v1H1zM7 1h1v1H7zM1 7h1v1H1z" fill="#FFFFFF" />
      <path d="M4 0h1v2H4zM3 4h2v1H3zM6 4h1v2H6zM4 6h1v3H4zM7 6h2v1H7zM6 8h2v1H6z" fill="#14212B" />
    </svg>
  );
}

export function QrisBox({
  due,
  paidAt,
  onSimulate,
}: {
  due: bigint;
  paidAt: string | null;
  onSimulate: () => void;
}) {
  return (
    <div className={cx(BOX, 'flex-row items-center gap-3', paidAt && 'border-[#B7DEC0] bg-[#EAF5EC]')}>
      <QrSample faded={!!paidAt} />
      <span className="flex min-w-0 flex-col gap-1">
        <span className={cx('font-semibold', paidAt ? 'text-success' : 'text-ink-900')}>
          {paidAt ? `Pembayaran QRIS diterima · ${formatRupiah(due)}` : `QRIS dinamis · ${formatRupiah(due)}`}
        </span>
        <span>
          {paidAt
            ? `Webhook TPDI masuk ${paidAt} · signature valid · dana langsung ke BTN ${REKENING.operasional}`
            : 'Diterbitkan via TPDI · acquirer BTN · berlaku 10 menit · status diperbarui otomatis lewat webhook'}
        </span>
        {!paidAt && (
          <button type="button" onClick={onSimulate} className={cx(SIM_BTN, 'self-start')}>
            Simulasikan pembayaran diterima
          </button>
        )}
      </span>
    </div>
  );
}

export function VaBox({
  due,
  vaNumber,
  paidAt,
  onSimulate,
}: {
  due: bigint;
  vaNumber: string;
  paidAt: string | null;
  onSimulate: () => void;
}) {
  return (
    <div className={BOX}>
      <span className="font-semibold text-ink-900">
        VA BTN <span className="font-mono">{vaNumber}</span> · via TPDI
      </span>
      <span>1. Berikan nomor VA ke pasien (tercetak di slip dan dikirim lewat WhatsApp).</span>
      <span>2. Pasien transfer tepat {formatRupiah(due)} lewat m-banking/ATM; berlaku 24 jam.</span>
      <span>
        3. Status lunas otomatis saat webhook TPDI masuk (signature diverifikasi); dana langsung ke BTN{' '}
        {REKENING.operasional}.
      </span>
      {paidAt ? (
        <span
          role="status"
          className="rounded-[8px] border border-[#B7DEC0] bg-[#EAF5EC] px-2.5 py-2 font-semibold text-success"
        >
          Webhook TPDI diterima {paidAt} · payment.paid · status lunas
        </span>
      ) : (
        <button type="button" onClick={onSimulate} className={cx(SIM_BTN, 'self-start')}>
          Simulasikan pembayaran VA
        </button>
      )}
    </div>
  );
}

export function DebitBox({ due, ok, onToggle }: { due: bigint; ok: boolean; onToggle: () => void }) {
  return (
    <div className={BOX}>
      <span className="font-semibold text-ink-900">
        EDC BTN kasir 01 · {formatRupiah(due)} sudah dikirim ke mesin
      </span>
      <span>1. Minta pasien tap atau masukkan kartu debit/kredit, lalu PIN.</span>
      <span>2. Tunggu struk &quot;APPROVED&quot;; kode approval tercatat otomatis.</span>
      <span>3. Jika ditolak, tawarkan metode lain. Jangan input nominal manual di EDC.</span>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 font-medium text-ink-900">
        <input type="checkbox" checked={ok} onChange={onToggle} className="size-[18px] accent-brand-600" />
        Struk EDC approved diterima
      </label>
    </div>
  );
}

export function CashBox({ due, cash, onCash }: { due: bigint; cash: string; onCash: (v: string) => void }) {
  const id = useId();
  const received = digitsToRupiah(cash);
  const c = cashChange(due, received);
  const up = (step: bigint) => ((due + step - 1n) / step) * step;
  const quick = [
    ...new Set([due, up(50_000n), up(100_000n) === up(50_000n) ? up(100_000n) + 100_000n : up(100_000n)]),
  ];
  return (
    <div className={BOX}>
      <label htmlFor={id} className="font-semibold text-ink-900">
        Uang diterima
      </label>
      <span className="flex items-center gap-2">
        <span className="font-mono text-ink-500">Rp</span>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          placeholder="0"
          value={received > 0n ? received.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') : ''}
          onChange={(e) => onCash(e.target.value)}
          aria-invalid={cash !== '' && !c.enough}
          className={cx(
            'h-11 min-w-0 flex-1 rounded-[8px] border bg-white px-2.5 font-mono text-base',
            cash !== '' && !c.enough ? 'border-danger' : 'border-line-strong',
          )}
        />
      </span>
      <span className="flex flex-wrap gap-1.5">
        {quick.map((v, i) => (
          <button
            key={v.toString()}
            type="button"
            onClick={() => onCash(v.toString())}
            className="min-h-11 cursor-pointer rounded-[8px] border border-line-strong bg-white px-2.5 font-[inherit] font-medium"
          >
            {i === 0 ? 'Uang pas' : formatRupiah(v)}
          </button>
        ))}
      </span>
      <span aria-live="polite" className="flex justify-between border-t border-line pt-1.5 text-[13px]">
        <span>{cash !== '' && !c.enough ? 'Kurang' : 'Kembalian'}</span>
        <span
          className={cx(
            'font-mono font-bold',
            cash === '' ? 'text-ink-500' : c.enough ? 'text-success' : 'text-danger',
          )}
        >
          {cash === '' ? '—' : formatRupiah(c.enough ? c.change : c.short)}
        </span>
      </span>
    </div>
  );
}

export function TransferBox({
  reference,
  verified,
  onReference,
  onVerified,
}: {
  reference: string;
  verified: boolean;
  onReference: (v: string) => void;
  onVerified: () => void;
}) {
  const id = useId();
  return (
    <div className={BOX}>
      <span className="font-semibold text-ink-900">Transfer ke BTN operasional {REKENING.operasional}</span>
      <label htmlFor={id} className="font-medium text-ink-900">
        Nomor referensi transfer
      </label>
      <input
        id={id}
        autoComplete="off"
        maxLength={40}
        value={reference}
        onChange={(e) => onReference(e.target.value)}
        className="h-11 rounded-[8px] border border-line-strong bg-white px-2.5 font-mono"
      />
      <label className="flex min-h-11 cursor-pointer items-center gap-2 font-medium text-ink-900">
        <input
          type="checkbox"
          checked={verified}
          onChange={onVerified}
          className="size-[18px] accent-brand-600"
        />
        Dana masuk terverifikasi di mutasi BTN (H2H)
      </label>
    </div>
  );
}
