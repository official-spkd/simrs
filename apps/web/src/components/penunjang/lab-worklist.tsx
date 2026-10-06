import type { LabSample } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { formatTat, type StatusTone } from '@/lib/penunjang';
import { ROW_HOVER, ROW_SELECTED, STATUS_CHIP } from './pelangi';

/** Chip status 100/800 (Pelangi Klinis): koral, kunyit, zamrud, aksen domain, batu. */
export const TONE_CHIP: Record<StatusTone, string> = {
  danger: STATUS_CHIP.danger,
  warning: STATUS_CHIP.warning,
  success: STATUS_CHIP.success,
  brand: STATUS_CHIP.brand,
  neutral: STATUS_CHIP.neutral,
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
      className="flex min-w-0 flex-[1_1_300px] flex-col overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card lg:max-w-[380px]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="m-0 text-[15px] font-semibold">Worklist</h2>
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
                  'grid min-h-11 w-full cursor-pointer grid-cols-[4px_minmax(0,1fr)_auto] gap-2.5 border-0 border-b border-line-soft py-2.5 pr-3.5 text-left font-[inherit] text-inherit transition-colors',
                  sel ? ROW_SELECTED : cx('bg-transparent', ROW_HOVER),
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'self-stretch',
                    criticalOpen ? 'bg-koral-600' : sel ? 'bg-brand-600' : 'bg-transparent',
                  )}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                    {s.patient.name}
                    {s.priority === 'cito' && (
                      <span className="rounded-full bg-koral-100 px-2 text-[11px] font-semibold text-koral-800">
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
                    className={cx(
                      'font-mono text-caption',
                      criticalOpen ? 'font-semibold text-koral-800' : 'text-ink-500',
                    )}
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
