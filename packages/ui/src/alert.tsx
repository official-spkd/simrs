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
      className={cx('flex gap-2.5 rounded-control border px-3.5 py-2.5', l.box, className)}
    >
      <span className={cx('font-bold', l.title)}>{title ?? l.label}</span>
      <span className="text-ink-700">{children}</span>
    </div>
  );
}
