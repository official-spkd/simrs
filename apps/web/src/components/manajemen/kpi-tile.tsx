import { cx } from '@simrs/ui';
import type { ReactNode } from 'react';
import { KPI_FRAME, kpiTint } from '../backoffice/styles';

/**
 * Kartu KPI papan C14/C40: gradien satu rona (100 → 50) bergiliran per kartu (`index`), kilau sekali. Arah/status
 * tetap tertulis di `hint` dengan warna status, jadi rona kartu hanya identitas, bukan makna.
 */
export function KpiTile({
  index,
  label,
  value,
  hint,
  detail,
  tone = 'neutral',
}: {
  index: number;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  detail?: ReactNode;
  tone?: 'neutral' | 'danger' | 'warning' | 'success';
}) {
  const hintTone = {
    neutral: 'text-ink-700',
    danger: 'text-danger',
    warning: 'text-warning',
    success: 'text-success',
  }[tone];
  return (
    <div className={cx(KPI_FRAME, kpiTint(index))}>
      <span className="text-caption font-medium text-ink-700">{label}</span>
      <span className="text-kpi leading-tight font-bold tracking-[-0.03em] text-ink-900">{value}</span>
      {hint && <span className={cx('text-caption font-semibold', hintTone)}>{hint}</span>}
      {detail && <span className="text-[11.5px] text-ink-700">{detail}</span>}
    </div>
  );
}
