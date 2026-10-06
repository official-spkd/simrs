'use client';

import { cx } from '@simrs/ui';
import { useId } from 'react';
import { reasonShortBy } from '@/lib/rme';

export interface FeedbackMsg {
  ok: boolean;
  text: string;
}

/** Umpan balik aksi berjam ("Final · 10.41 (simulasi, tidak disimpan)"); gagal = `alert`. */
export function Feedback({ msg, className }: { msg: FeedbackMsg | null; className?: string }) {
  if (!msg) return null;
  return (
    <p
      role={msg.ok ? 'status' : 'alert'}
      className={cx(
        'm-0 rounded-control border px-3.5 py-2.5 text-small font-semibold',
        msg.ok
          ? 'border-success-border bg-success-bg text-success'
          : 'border-warning-border bg-warning-bg text-warning',
        className,
      )}
    >
      {msg.text}
    </p>
  );
}

/** Isian alasan wajib (koreksi, override, pembatalan) dengan hitungan karakter tersisa. */
export function ReasonField({
  label,
  value,
  onChange,
  hint,
  min = 10,
  showError = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  min?: number;
  /** Tampilkan galat bila masih kurang (setelah pengguna mencoba menyimpan). */
  showError?: boolean;
}) {
  const id = useId();
  const short = reasonShortBy(value, min);
  const error = showError && short > 0;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small font-semibold">
        {label} <span className="text-danger">*</span>
      </label>
      <textarea
        id={id}
        rows={2}
        value={value}
        maxLength={500}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-info`}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          'rounded-control border bg-white px-3 py-2 font-[inherit]',
          error ? 'border-danger' : 'border-line-strong',
        )}
      />
      <span id={`${id}-info`} className={cx('text-caption', error ? 'text-danger' : 'text-ink-500')}>
        {short > 0
          ? `Wajib minimal ${min} karakter · ${short} karakter lagi.`
          : (hint ?? 'Tercatat di jejak audit bersama nama dan jam.')}
      </span>
    </div>
  );
}
