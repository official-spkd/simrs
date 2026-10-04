import type { LabSample } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { formatTat, type StatusTone } from '@/lib/penunjang';

export const TONE_CHIP: Record<StatusTone, string> = {
  danger: 'bg-danger-bg text-danger',
  warning: 'bg-warning-bg text-warning',
  success: 'bg-success-bg text-success',
  brand: 'bg-brand-50 text-brand-700',
  neutral: 'bg-muted text-ink-700',
};

export interface WorklistRow {
  sample: LabSample;
  status: { label: string; tone: StatusTone };
  criticalOpen: boolean;
}

/** Worklist laboratorium (mockup Lab): status, prioritas, barcode, dan waktu tunggu; pilihan baris lewat tombol. */
export function LabWorklistPanel({
  rows,
  selected,
  onSelect,
}: {
  rows: readonly WorklistRow[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section
      aria-label="Worklist"
      className="flex min-w-0 flex-[1_1_300px] flex-col overflow-hidden rounded-card border border-line bg-white lg:max-w-[380px]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="m-0 text-body font-semibold">Worklist</h2>
        <span className="text-[12.5px] text-ink-500">urut: prioritas, lalu waktu</span>
      </div>
      <ul className="m-0 list-none p-0">
        {rows.map(({ sample: s, status, criticalOpen }) => {
          const sel = s.id === selected;
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-pressed={sel}
                onClick={() => onSelect(s.id)}
                className={cx(
                  'grid min-h-11 w-full cursor-pointer grid-cols-[4px_minmax(0,1fr)_auto] gap-2.5 border-0 border-b border-line-soft py-2.5 pr-3.5 text-left font-[inherit] text-inherit',
                  sel ? 'bg-selected' : 'bg-white',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'self-stretch',
                    criticalOpen ? 'bg-danger' : sel ? 'bg-brand-600' : 'bg-transparent',
                  )}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                    {s.patient.name}
                    {s.priority === 'cito' && (
                      <span className="rounded-full border border-danger-border px-1.5 text-[11px] font-semibold text-danger">
                        Cito
                      </span>
                    )}
                  </span>
                  <span className="text-[12.5px] text-ink-500">
                    {s.location} · {s.tests}
                  </span>
                  <span className="font-mono text-[11.5px] text-ink-500">
                    <span className="sr-only">Barcode </span>
                    {s.labNo}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span
                    className={cx(
                      'rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
                      TONE_CHIP[status.tone],
                    )}
                  >
                    {status.label}
                  </span>
                  <span
                    className={cx('font-mono text-caption', criticalOpen ? 'text-danger' : 'text-ink-500')}
                  >
                    <span className="sr-only">Waktu tunggu </span>
                    {formatTat(s)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
