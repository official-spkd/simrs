import type { ReactNode } from 'react';
import { cx } from './cx';

export type AlertLevel = 'critical' | 'warning' | 'info' | 'success';

const levels: Record<AlertLevel, { label: string; box: string; title: string }> = {
  critical: {
    label: 'Kritis',
    box: 'bg-alert-critical border-koral-200 text-koral-900',
    title: 'text-koral-800',
  },
  warning: {
    label: 'Perhatian',
    box: 'bg-alert-warning border-kunyit-200 text-kunyit-900',
    title: 'text-kunyit-800',
  },
  info: {
    label: 'Info',
    box: 'bg-alert-info border-samudra-200 text-samudra-900',
    title: 'text-samudra-700',
  },
  success: {
    label: 'Berhasil',
    box: 'bg-alert-success border-zamrud-200 text-zamrud-900',
    title: 'text-zamrud-700',
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
        'flex flex-wrap gap-x-2.5 gap-y-1 rounded-[14px] border px-3.5 py-3',
        l.box,
        className,
      )}
    >
      {/* Judul tidak dipersempit kata per kata: isi di sampingnya bila lebarnya cukup (≥ 12rem), selain itu di bawah. */}
      <span className={cx('max-w-full font-bold', l.title)}>{title ?? l.label}</span>
      <span className="min-w-48 flex-1">{children}</span>
    </div>
  );
}
