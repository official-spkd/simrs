import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';

export type ChipTone = 'brand' | 'neutral' | 'warning' | 'success' | 'danger' | 'info';

const tones: Record<ChipTone, string> = {
  brand: 'bg-brand-50 text-brand-700',
  neutral: 'bg-[#F1F3F5] text-ink-700',
  warning: 'bg-warning-bg text-warning',
  success: 'bg-[#EAF6EC] text-success',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
};

/** Status selalu berupa teks, tidak hanya warna. */
export function Chip({
  tone = 'neutral',
  mono,
  icon,
  children,
  className,
}: {
  tone?: ChipTone;
  mono?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-caption font-semibold',
        mono && 'font-mono',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export const STATUS_TONE = {
  diperiksa: 'brand',
  menunggu: 'neutral',
  'menunggu-hasil': 'warning',
  selesai: 'success',
  dibatalkan: 'danger',
  terkirim: 'info',
} as const satisfies Record<string, ChipTone>;

export function StatusChip({ status, children }: { status: keyof typeof STATUS_TONE; children: ReactNode }) {
  return <Chip tone={STATUS_TONE[status]}>{children}</Chip>;
}

/** Chip filter yang bisa dipilih (aria-pressed). */
export function FilterChip({
  selected,
  children,
  className,
  ...rest
}: { selected: boolean; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        'inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-small font-[inherit]',
        selected
          ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
          : 'border-line-strong bg-white text-ink-700',
        className,
      )}
      {...rest}
    >
      {selected && <Icon name="check" size={13} strokeWidth={2.4} />}
      {children}
    </button>
  );
}
