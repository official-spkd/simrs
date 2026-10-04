import { Chip, type ChipTone, cx, Icon, type IconName } from '@simrs/ui';
import type { ReactNode } from 'react';
import { VALUE_FLAG_LABEL, type ValueFlag } from '@/lib/klinis';

const INLINE_TONE: Record<ChipTone, string> = {
  brand: 'text-brand-700',
  neutral: 'text-ink-700',
  warning: 'text-warning',
  success: 'text-success',
  danger: 'text-danger',
  info: 'text-info',
};

/**
 * Penanda status bertulisan + ikon (CLAUDE.md §6, WCAG 1.4.1: status tidak hanya lewat warna), mis. lama tinggal
 * lewat batas, permintaan bed terlambat. Ikon dekoratif; teksnya yang dibaca pembaca layar. `inline` = tanpa latar
 * (kolom tabel sempit; teks boleh membungkus).
 */
export function StatusFlag({
  icon,
  tone = 'danger',
  inline,
  children,
  className,
}: {
  icon: IconName;
  tone?: ChipTone;
  inline?: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (inline) {
    return (
      <span
        className={cx(
          'inline-flex items-start gap-1 text-caption font-semibold',
          INLINE_TONE[tone],
          className,
        )}
      >
        <Icon name={icon} size={13} strokeWidth={2.2} className="mt-px flex-none" />
        <span>{children}</span>
      </span>
    );
  }
  return (
    <Chip
      tone={tone}
      icon={<Icon name={icon} size={13} strokeWidth={2.2} className="flex-none" />}
      className={className}
    >
      {children}
    </Chip>
  );
}

const VALUE_ICON: Record<ValueFlag, IconName> = {
  tinggi: 'arrowUp',
  rendah: 'arrowDown',
  abnormal: 'alert',
  kritis: 'alert',
};

/** Penanda ringkas nilai di luar batas (ubin tanda vital, daftar hasil lab): "↑ Tinggi", "↓ Rendah", "Kritis". */
export function ValueFlagBadge({ flag, className }: { flag: ValueFlag; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex flex-none items-center gap-0.5 rounded-full px-1.5 text-[11px] leading-[18px] font-bold whitespace-nowrap',
        flag === 'kritis' ? 'bg-danger text-white' : 'bg-danger-bg text-danger',
        className,
      )}
    >
      <Icon name={VALUE_ICON[flag]} size={11} strokeWidth={2.6} />
      {VALUE_FLAG_LABEL[flag]}
    </span>
  );
}
