import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'sm' | 'kiosk';

const variants: Record<ButtonVariant, string> = {
  primary: 'border border-brand-800 bg-btn-primary text-white font-semibold shadow-button',
  secondary: 'border border-line-strong bg-white text-ink-900 font-medium',
  danger: 'border border-[#9A1E14] bg-btn-danger text-white font-semibold shadow-button',
  ghost: 'border-0 bg-transparent text-brand-600 font-medium',
};

const sizes: Record<ButtonSize, string> = {
  md: 'h-11 px-[18px]',
  sm: 'h-10 px-3.5',
  kiosk: 'h-16 px-6 text-kiosk',
};

const disabledStyle =
  'disabled:border-line disabled:bg-muted disabled:bg-none disabled:text-ink-400 disabled:shadow-none disabled:cursor-not-allowed';

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
