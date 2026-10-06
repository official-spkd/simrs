import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';

export type ChipTone = 'brand' | 'neutral' | 'warning' | 'success' | 'danger' | 'info';

const tones: Record<ChipTone, string> = {
  brand: 'bg-brand-100 text-brand-800',
  neutral: 'bg-batu-200 text-batu-800',
  warning: 'bg-kunyit-100 text-kunyit-800',
  success: 'bg-zamrud-100 text-zamrud-700',
  danger: 'bg-koral-100 text-koral-800',
  info: 'bg-samudra-100 text-samudra-700',
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
        'inline-flex items-center gap-1.5 rounded-full px-[11px] py-1 text-caption font-semibold',
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
          ? 'border-transparent bg-nav-active font-semibold text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]'
          : 'border-[rgba(23,32,46,0.12)] bg-white/90 text-ink-700 hover:bg-white',
        className,
      )}
      {...rest}
    >
      {selected && <Icon name="check" size={13} strokeWidth={2.4} />}
      {children}
    </button>
  );
}
