import { type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { cx } from './cx';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  required?: boolean;
  /** Teks bantuan atau status valid (mis. "Terverifikasi Dukcapil"). */
  hint?: ReactNode;
  /** Warna hint: `success` untuk status valid (bawaan), `muted` untuk teks bantuan netral. */
  hintTone?: 'success' | 'muted';
  /** Pesan galat; bila ada, field ditandai invalid dan pesan menjelaskan cara memperbaiki. */
  error?: string | null;
  id?: string;
}

/** Label selalu terlihat di atas field; galat tepat di bawah field. */
export function Field({
  label,
  required,
  hint,
  hintTone = 'success',
  error,
  id,
  className,
  ...input
}: FieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const msgId = `${fieldId}-msg`;
  const invalid = Boolean(error);
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={fieldId} className="text-small font-semibold text-ink-700">
        {label}
        {required && (
          <span className="text-danger" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      <input
        id={fieldId}
        required={required}
        aria-invalid={invalid}
        aria-describedby={hint || error ? msgId : undefined}
        className={cx(
          'h-10 rounded-control border px-3 font-[inherit] text-ink-900',
          invalid ? 'border-danger bg-[#FFFBFA]' : 'border-line-strong bg-white',
        )}
        {...input}
      />
      {(error || hint) && (
        <span
          id={msgId}
          className={cx(
            'text-caption',
            invalid ? 'text-danger' : hintTone === 'muted' ? 'text-ink-500' : 'text-success',
          )}
        >
          {error ?? hint}
        </span>
      )}
    </div>
  );
}
