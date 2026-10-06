import type { ReactNode } from 'react';
import { cx } from './cx';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-card border border-white/95 bg-white/90 shadow-card', className)}>
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
  // Gradien satu rona, gelap → terang (100 → 50): domain untuk netral, rona status untuk nada lain.
  const tint = {
    neutral: 'bg-[linear-gradient(135deg,var(--color-brand-100),var(--color-brand-50))]',
    danger: 'bg-[linear-gradient(135deg,var(--color-koral-100),var(--color-koral-50))]',
    warning: 'bg-[linear-gradient(135deg,var(--color-kunyit-100),var(--color-kunyit-50))]',
    success: 'bg-[linear-gradient(135deg,var(--color-zamrud-100),var(--color-zamrud-50))]',
  }[tone];
  return (
    <Card className={cx('shine-once flex flex-col gap-1 px-4 py-3.5', tinted && tint)}>
      <span className="text-caption font-semibold text-ink-500">{label}</span>
      <span className="text-kpi font-bold leading-tight tracking-[-0.03em] text-ink-900">{value}</span>
      {hint && <span className={cx('text-caption font-medium', hintTone)}>{hint}</span>}
      {detail && <span className="text-[11.5px] text-ink-500">{detail}</span>}
    </Card>
  );
}
