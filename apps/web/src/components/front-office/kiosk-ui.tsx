import { cx, Icon, type IconName } from '@simrs/ui';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Primitif layar anjungan (F05, kanvas 1080×1920, mockup Anjungan). Ukuran huruf memakai `--k` (1 atau 1,2 saat
 * "Huruf lebih besar") sehingga seluruh teks membesar tanpa mengubah tata letak; target sentuh ≥ 64 px.
 */
export const fs = (px: number): CSSProperties => ({ fontSize: `calc(${px}px * var(--k, 1))` });

export const KIOSK_PRIMARY =
  'border-2 border-brand-800 bg-[linear-gradient(180deg,var(--color-brand-500),var(--color-brand-600))] text-white shadow-[0_6px_16px_color-mix(in_srgb,_var(--color-brand-600)_25%,_transparent)] disabled:border-line disabled:bg-none disabled:bg-muted disabled:text-ink-400 disabled:shadow-none disabled:cursor-not-allowed';
export const KIOSK_SECONDARY = 'border-2 border-line-strong bg-white text-ink-900';

export function KioskOption({
  title,
  desc,
  icon,
  primary,
  tag,
  onClick,
  disabled,
  large,
  chevron = true,
}: {
  title: string;
  desc: string;
  icon: IconName;
  primary?: boolean;
  tag?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Kartu tujuan di layar awal (mockup: tinggi 188, ikon 112) lebih besar dari kartu cara identifikasi (168, 104). */
  large?: boolean;
  /** false = tanpa panah (kartu cara identifikasi di mockup hanya menampilkan label "Disarankan"). */
  chevron?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex cursor-pointer items-center gap-8 rounded-[28px] border-2 px-10 text-left font-[inherit] shadow-[0_2px_4px_rgba(16,24,40,0.05),0_10px_30px_rgba(16,24,40,0.07)] disabled:cursor-wait disabled:opacity-70',
        large ? 'min-h-[188px] py-9' : 'min-h-[168px] py-8',
        primary
          ? 'border-brand-700 bg-[linear-gradient(135deg,#12807A_0%,var(--color-brand-600)_55%,var(--color-brand-700)_100%)] text-white'
          : 'border-line bg-white text-ink-900',
      )}
    >
      <span
        className={cx(
          'flex flex-none items-center justify-center rounded-[26px]',
          large ? 'size-28' : 'size-[104px]',
          primary ? 'bg-white/15 text-white' : 'bg-brand-50 text-brand-700',
        )}
      >
        <Icon name={icon} size={large ? 56 : 52} strokeWidth={1.6} />
      </span>
      <span className="flex flex-1 flex-col gap-2">
        <span className="font-bold" style={fs(36)}>
          {title}
        </span>
        <span className={primary ? 'text-brand-100' : 'text-ink-700'} style={fs(22)}>
          {desc}
        </span>
      </span>
      {tag ? (
        <span className={cx('font-semibold', primary ? 'text-brand-100' : 'text-ink-700')} style={fs(20)}>
          {tag}
        </span>
      ) : chevron ? (
        <Icon name="chevronRight" size={40} strokeWidth={2} />
      ) : null}
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

export function KioskTitle({
  title,
  sub,
  size = 52,
}: {
  title: ReactNode;
  sub: ReactNode;
  /** Ukuran judul (mockup: 56 di layar cara identifikasi, 52 di layar masukan dan konfirmasi). */
  size?: 52 | 56;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="m-0 leading-[1.15] font-bold tracking-[-0.01em]" style={fs(size)}>
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
    success: 'border-success-border bg-[linear-gradient(90deg,var(--color-zamrud-50),#FFFFFF)] text-success',
    info: 'border-info-border bg-[linear-gradient(90deg,var(--color-samudra-50),#FFFFFF)] text-info',
    warning: 'border-warning-border bg-[linear-gradient(90deg,var(--color-kunyit-50),#FFFFFF)] text-warning',
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
