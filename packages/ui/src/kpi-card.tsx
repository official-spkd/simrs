import type { ReactNode } from 'react';
import { cx } from './cx';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-card border border-line bg-card shadow-card', className)}>
      {children}
    </section>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'danger' | 'warning' | 'success';
}) {
  const hintTone = {
    neutral: 'text-ink-500',
    danger: 'text-danger',
    warning: 'text-warning',
    success: 'text-success',
  }[tone];
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-caption font-semibold text-ink-500">{label}</span>
      <span className="text-kpi font-bold leading-tight text-ink-900">{value}</span>
      {hint && <span className={cx('text-caption', hintTone)}>{hint}</span>}
    </Card>
  );
}
