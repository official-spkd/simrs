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
  detail,
  tone = 'neutral',
  tinted = false,
}: {
  label: string;
  value: ReactNode;
  /** Keterangan berwarna sesuai `tone` (mis. perubahan "▲ 3 poin"). */
  hint?: ReactNode;
  /** Keterangan abu-abu tambahan (mis. sasaran). */
  detail?: ReactNode;
  tone?: 'neutral' | 'danger' | 'warning' | 'success';
  /** Gradasi lembut sesuai `tone` (kartu KPI dasbor). */
  tinted?: boolean;
}) {
  const hintTone = {
    neutral: 'text-ink-500',
    danger: 'text-danger',
    warning: 'text-warning',
    success: 'text-success',
  }[tone];
  const tint = {
    neutral: '',
    danger: 'bg-[linear-gradient(160deg,#FFFFFF_55%,rgba(180,35,24,0.06))]',
    warning: 'bg-[linear-gradient(160deg,#FFFFFF_55%,rgba(138,75,0,0.06))]',
    success: 'bg-[linear-gradient(160deg,#FFFFFF_55%,rgba(30,107,52,0.06))]',
  }[tone];
  return (
    <Card className={cx('flex flex-col gap-1 p-4', tinted && tint)}>
      <span className="text-caption font-semibold text-ink-500">{label}</span>
      <span className="text-kpi font-bold leading-tight text-ink-900">{value}</span>
      {hint && <span className={cx('text-caption font-medium', hintTone)}>{hint}</span>}
      {detail && <span className="text-[11.5px] text-ink-500">{detail}</span>}
    </Card>
  );
}
