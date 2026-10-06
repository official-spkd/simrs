'use client';

import { formatRupiah, REFUND_REASONS, type Refund } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useId } from 'react';
import { digits, REFUND_NOTE_MIN, REFUND_REASON_LABEL, type RefundDraftErrors } from '@/lib/btn';

export interface RefundDraft {
  amount: string;
  reason: string;
  note: string;
}

/** Isian pengajuan refund (draf): nominal ≤ kelebihan deposit, alasan wajib, keterangan ≥ 15 karakter. */
export function RefundForm({
  refund,
  draft,
  errors,
  tried,
  onChange,
}: {
  refund: Refund;
  draft: RefundDraft;
  errors: RefundDraftErrors;
  tried: boolean;
  onChange: (next: RefundDraft) => void;
}) {
  const id = useId();
  const amount = draft.amount ? BigInt(draft.amount) : 0n;
  const amountMsg =
    errors.amount ??
    (refund.maxAmount ? `Maksimal ${formatRupiah(BigInt(refund.maxAmount))} (kelebihan deposit).` : '');
  const len = draft.note.trim().length;
  return (
    <div className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-subtle p-3">
      <div className="flex flex-wrap gap-3">
        <span className="flex min-w-0 flex-[1_1_160px] flex-col gap-1">
          <label htmlFor={`${id}-nominal`} className="text-small font-semibold text-ink-700">
            Nominal refund
          </label>
          <span className="flex items-center gap-1.5">
            <span className="text-small text-ink-500">Rp</span>
            <input
              id={`${id}-nominal`}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={amount > 0n ? digits(amount) : ''}
              aria-invalid={!!errors.amount}
              aria-describedby={`${id}-nominal-msg`}
              onChange={(e) =>
                onChange({
                  ...draft,
                  amount: e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 13),
                })
              }
              className={cx(
                'h-11 w-full rounded-control border bg-white px-3 text-right font-mono',
                errors.amount ? 'border-danger' : 'border-line-strong',
              )}
            />
          </span>
          <span
            id={`${id}-nominal-msg`}
            className={cx('text-caption', errors.amount ? 'font-semibold text-danger' : 'text-ink-500')}
          >
            {amountMsg}
          </span>
        </span>
        <span className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
          <label htmlFor={`${id}-alasan`} className="text-small font-semibold text-ink-700">
            Alasan refund (wajib)
          </label>
          <select
            id={`${id}-alasan`}
            value={draft.reason}
            aria-invalid={tried && !!errors.reason}
            aria-describedby={`${id}-alasan-msg`}
            onChange={(e) => onChange({ ...draft, reason: e.target.value })}
            className={cx(
              'h-11 rounded-control border bg-white px-2 font-[inherit]',
              tried && errors.reason ? 'border-danger' : 'border-line-strong',
            )}
          >
            <option value="">Pilih alasan…</option>
            {REFUND_REASONS.map((r) => (
              <option key={r} value={r}>
                {REFUND_REASON_LABEL[r]}
              </option>
            ))}
          </select>
          <span id={`${id}-alasan-msg`} className="text-caption font-semibold text-danger">
            {tried ? (errors.reason ?? '') : ''}
          </span>
        </span>
      </div>
      <label htmlFor={`${id}-ket`} className="text-small font-semibold text-ink-700">
        Keterangan (wajib, min. {REFUND_NOTE_MIN} karakter)
      </label>
      <textarea
        id={`${id}-ket`}
        rows={2}
        maxLength={300}
        value={draft.note}
        aria-invalid={tried && !!errors.note}
        aria-describedby={`${id}-ket-msg`}
        onChange={(e) => onChange({ ...draft, note: e.target.value })}
        placeholder="mis. Bagian pasien final Rp 3.850.000; kelebihan deposit dikembalikan ke rekening asal"
        className={cx(
          'rounded-control border bg-white px-3 py-2 font-[inherit]',
          tried && errors.note ? 'border-danger' : 'border-line-strong',
        )}
      />
      <span
        id={`${id}-ket-msg`}
        className={cx('text-caption', tried && errors.note ? 'font-semibold text-danger' : 'text-ink-500')}
      >
        {tried && errors.note
          ? errors.note
          : `${len} karakter · tercatat di jejak audit dan dibaca penyetuju`}
      </span>
    </div>
  );
}
