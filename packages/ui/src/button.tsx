import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'sm' | 'kiosk';

const variants: Record<ButtonVariant, string> = {
  primary:
    'border border-transparent bg-btn-primary text-white font-semibold shadow-button hover:brightness-[1.07] hover:shadow-[0_10px_26px_color-mix(in_srgb,var(--color-brand-600)_42%,transparent)]',
  secondary:
    'border border-[rgba(23,32,46,0.12)] bg-white/95 text-ink-900 font-semibold hover:shadow-[0_6px_16px_rgba(23,32,46,0.12)]',
  danger:
    'border border-transparent bg-btn-danger text-white font-semibold shadow-[0_8px_20px_rgba(194,50,33,0.3)] hover:brightness-[1.07]',
  ghost: 'border-0 bg-transparent text-brand-700 font-semibold hover:bg-brand-50',
};

/**
 * Semua ukuran memenuhi target sentuh ≥ 44 px (h-11; anjungan 64 px); `sm` hanya lebih ringkas ke samping. Tetap
 * kelas angka (bukan `h-touch`) agar `className` pemanggil seperti `h-12`/`h-auto` tetap menang urutan CSS-nya.
 */
const sizes: Record<ButtonSize, string> = {
  md: 'h-11 px-[18px]',
  sm: 'h-11 px-3.5',
  kiosk: 'h-16 px-6 text-kiosk',
};

const disabledStyle =
  'disabled:border-line disabled:bg-muted disabled:bg-none disabled:text-ink-400 disabled:shadow-none disabled:brightness-100 disabled:cursor-not-allowed';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Satu tombol utama per area. Aksi destruktif selalu meminta konfirmasi + alasan (lihat Fondasi). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex cursor-pointer items-center justify-center gap-2 rounded-control font-[inherit]',
        variants[variant],
        sizes[size],
        disabledStyle,
        className,
      )}
      {...rest}
    />
  );
});
