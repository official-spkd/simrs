'use client';

import { Button, type ButtonVariant, cx } from '@simrs/ui';
import { type ReactNode, useId, useState } from 'react';

/**
 * Aksi beralasan (gerbang docs/08 §5): alasan tertulis minimal `min` karakter sebelum tombol aktif; tombol yang
 * belum boleh dipakai tetap terlihat, nonaktif, dan alasannya tertulis di dekatnya. `blocked` = alasan lain tombol
 * nonaktif (mis. pembuat = penyetuju). Alasan dikirim sudah dipangkas.
 */
export function AlasanForm({
  label,
  submitLabel,
  min = 15,
  placeholder,
  blocked,
  variant = 'primary',
  children,
  onSubmit,
  onCancel,
}: {
  /** Label isian, mis. "Alasan penyesuaian (wajib)". */
  label: string;
  submitLabel: string;
  min?: number;
  placeholder?: string;
  blocked?: string | null;
  variant?: ButtonVariant;
  /** Isi tambahan di atas isian alasan (ringkasan, pilihan). */
  children?: ReactNode;
  onSubmit: (reason: string) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const len = reason.trim().length;
  const short = min - len;
  const problem = blocked ?? (short > 0 ? `Tulis alasan minimal ${min} karakter (${short} lagi).` : null);
  return (
    <form
      aria-label={submitLabel}
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) onSubmit(reason.trim());
      }}
    >
      {children}
      <label htmlFor={`${id}-alasan`} className="text-small font-semibold text-ink-700">
        {label}
      </label>
      <textarea
        id={`${id}-alasan`}
        rows={2}
        maxLength={300}
        value={reason}
        placeholder={placeholder}
        aria-describedby={`${id}-pesan`}
        onChange={(e) => setReason(e.target.value)}
        className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small"
      />
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span
          id={`${id}-pesan`}
          className={cx('text-caption', problem ? 'font-medium text-warning' : 'text-ink-500')}
        >
          {problem ?? `${len} karakter · tercatat di jejak audit`}
        </span>
        <span className="flex flex-wrap gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Batal
            </Button>
          )}
          <Button type="submit" variant={variant} disabled={!!problem}>
            {submitLabel}
          </Button>
        </span>
      </span>
    </form>
  );
}
