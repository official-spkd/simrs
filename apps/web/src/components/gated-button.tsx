'use client';

import { Button, type ButtonProps, cx } from '@simrs/ui';
import { type MouseEvent, type Ref, useId } from 'react';

/** Gaya nonaktif yang sama dengan `Button` (`disabled:`), tetapi untuk `aria-disabled`. */
const SOFT_DISABLED =
  'aria-disabled:border-line aria-disabled:bg-muted aria-disabled:bg-none aria-disabled:text-ink-400 aria-disabled:shadow-none aria-disabled:cursor-not-allowed';

/**
 * Tombol bergerbang (mockup: `aria-disabled` + `aria-describedby`): saat belum boleh dipakai tombol tetap bisa
 * difokus sehingga pembaca layar mendengar alasannya, klik diabaikan (atau memanggil `onBlocked`, mis. untuk
 * menampilkan galat validasi), dan alasan tampil sebagai teks (bukan hanya warna).
 */
export function GatedButton({
  enabled,
  reason,
  onBlocked,
  onClick,
  className,
  reasonClassName,
  children,
  type = 'button',
  ref,
  ...rest
}: Omit<ButtonProps, 'disabled'> & {
  ref?: Ref<HTMLButtonElement>;
  enabled: boolean;
  /** Alasan tombol belum bisa dipakai; tampil di bawah tombol saat `enabled` false. */
  reason?: string | null;
  onBlocked?: () => void;
  reasonClassName?: string;
}) {
  const id = useId();
  const why = !enabled && reason ? reason : null;
  const guard = (e: MouseEvent<HTMLButtonElement>) => {
    if (!enabled) {
      e.preventDefault();
      onBlocked?.();
      return;
    }
    onClick?.(e);
  };
  return (
    <>
      <Button
        {...rest}
        ref={ref}
        type={type}
        aria-disabled={!enabled}
        aria-describedby={why ? id : rest['aria-describedby']}
        onClick={guard}
        className={cx(SOFT_DISABLED, className)}
      >
        {children}
      </Button>
      {why && (
        <span id={id} className={cx('text-caption font-medium text-warning', reasonClassName)}>
          {why}
        </span>
      )}
    </>
  );
}
