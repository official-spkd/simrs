import type { ReactNode } from 'react';
import { cx } from './cx';

export type AlertLevel = 'critical' | 'warning' | 'info' | 'success';

const levels: Record<AlertLevel, { label: string; box: string; title: string }> = {
  critical: {
    label: 'Kritis',
    box: 'bg-[linear-gradient(90deg,#FEF3F2,#FFFFFF)] border-[#FECDCA]',
    title: 'text-danger',
  },
  warning: {
    label: 'Perhatian',
    box: 'bg-[linear-gradient(90deg,#FFF8EB,#FFFFFF)] border-[#F5D9A8]',
    title: 'text-warning',
  },
  info: {
    label: 'Info',
    box: 'bg-[linear-gradient(90deg,#EEF4FF,#FFFFFF)] border-[#C7D7FE]',
    title: 'text-info',
  },
  success: {
    label: 'Berhasil',
    box: 'bg-[linear-gradient(90deg,#EAF6EC,#FFFFFF)] border-[#BFE3C6]',
    title: 'text-success',
  },
};

/** Peringatan klinis 4 tingkat. Kritis memakai role="alert"; selebihnya role="status". */
export function Alert({
  level,
  title,
  children,
  className,
}: {
  level: AlertLevel;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const l = levels[level];
  return (
    <div
      role={level === 'critical' ? 'alert' : 'status'}
      className={cx(
        'flex flex-wrap gap-x-2.5 gap-y-1 rounded-control border px-3.5 py-2.5',
        l.box,
        className,
      )}
    >
      {/* Judul tidak dipersempit kata per kata: isi di sampingnya bila lebarnya cukup (≥ 12rem), selain itu di bawah. */}
      <span className={cx('max-w-full font-bold', l.title)}>{title ?? l.label}</span>
      <span className="min-w-48 flex-1 text-ink-700">{children}</span>
    </div>
  );
}
