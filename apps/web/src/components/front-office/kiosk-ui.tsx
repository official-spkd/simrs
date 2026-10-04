import { cx, Icon, type IconName } from '@simrs/ui';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Primitif layar anjungan (F05, kanvas 1080×1920, mockup Anjungan). Ukuran huruf memakai `--k` (1 atau 1,2 saat
 * "Huruf lebih besar") sehingga seluruh teks membesar tanpa mengubah tata letak; target sentuh ≥ 64 px.
 */
export const fs = (px: number): CSSProperties => ({ fontSize: `calc(${px}px * var(--k, 1))` });

export const KIOSK_PRIMARY =
  'border-2 border-brand-800 bg-[linear-gradient(180deg,#1D7E77,#0F766E)] text-white shadow-[0_6px_16px_rgba(15,118,110,0.25)] disabled:border-line disabled:bg-none disabled:bg-muted disabled:text-ink-400 disabled:shadow-none disabled:cursor-not-allowed';
export const KIOSK_SECONDARY = 'border-2 border-line-strong bg-white text-ink-900';

export function KioskOption({
  title,
  desc,
  icon,
  primary,
  tag,
  onClick,
  disabled,
}: {
  title: string;
  desc: string;
  icon: IconName;
  primary?: boolean;
  tag?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex min-h-[168px] cursor-pointer items-center gap-8 rounded-[28px] border-2 px-10 py-8 text-left font-[inherit] shadow-[0_2px_4px_rgba(16,24,40,0.05),0_10px_30px_rgba(16,24,40,0.07)] disabled:cursor-wait disabled:opacity-70',
        primary
          ? 'border-brand-700 bg-[linear-gradient(135deg,#12807A_0%,#0F766E_55%,#0B5D56_100%)] text-white'
          : 'border-line bg-white text-ink-900',
      )}
    >
      <span
        className={cx(
          'flex size-[104px] flex-none items-center justify-center rounded-[26px]',
          primary ? 'bg-white/15 text-white' : 'bg-brand-50 text-brand-700',
        )}
      >
        <Icon name={icon} size={52} strokeWidth={1.6} />
      </span>
      <span className="flex flex-1 flex-col gap-2">
        <span className="font-bold" style={fs(36)}>
          {title}
        </span>
        <span className={primary ? 'text-[#DDF2EE]' : 'text-ink-700'} style={fs(22)}>
          {desc}
        </span>
      </span>
      {tag ? (
        <span className={cx('font-semibold', primary ? 'text-[#DDF2EE]' : 'text-ink-700')} style={fs(20)}>
          {tag}
        </span>
      ) : (
        <Icon name="chevronRight" size={40} strokeWidth={2} />
      )}
    </button>
  );
}

export function KioskBackRow({ onBack, step }: { onBack: () => void; step: string }) {
  return (
    <div className="flex items-center justify-between gap-5">
      <button
        type="button"
        onClick={onBack}
        className={cx(
          'inline-flex h-[88px] cursor-pointer items-center gap-3 rounded-[22px] px-8 font-[inherit] font-semibold',
          KIOSK_SECONDARY,
        )}
        style={fs(26)}
      >
        <Icon name="chevronLeft" size={32} strokeWidth={2} />
        Kembali
      </button>
      <span className="font-semibold text-ink-700" style={fs(22)}>
        {step}
      </span>
    </div>
  );
}

export function KioskTitle({ title, sub }: { title: ReactNode; sub: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="m-0 leading-[1.15] font-bold tracking-[-0.01em]" style={fs(52)}>
        {title}
      </h1>
      <p className="m-0 text-ink-700" style={fs(24)}>
        {sub}
      </p>
    </div>
  );
}

/** Pesan status besar di anjungan (berhasil/info/peringatan); status juga tertulis, tidak hanya warna. */
export function KioskNotice({
  tone,
  children,
}: {
  tone: 'success' | 'info' | 'warning';
  children: ReactNode;
}) {
  const box = {
    success: 'border-success-border bg-[linear-gradient(90deg,#EAF6EC,#FFFFFF)] text-success',
    info: 'border-info-border bg-[linear-gradient(90deg,#EEF4FF,#FFFFFF)] text-info',
    warning: 'border-warning-border bg-[linear-gradient(90deg,#FFF8EB,#FFFFFF)] text-warning',
  }[tone];
  const icon: IconName = tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert';
  return (
    <div role="status" className={cx('flex items-center gap-5 rounded-[22px] border-2 px-7 py-6', box)}>
      <Icon name={icon} size={36} strokeWidth={2.2} />
      <span className="font-semibold" style={fs(24)}>
        {children}
      </span>
    </div>
  );
}
