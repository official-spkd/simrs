import { formatJam, type PharmacyPrescription } from '@simrs/shared';
import { cx } from '@simrs/ui';
import type { StatusTone } from '@/lib/penunjang';
import { TONE_CHIP } from './lab-worklist';

export interface QueueRow {
  rx: PharmacyPrescription;
  tag: { label: string; tone: StatusTone };
}

/** Antrean resep satu tab (mockup Farmasi): nama, lokasi, jumlah item, label status, jam resep. */
export function FarmasiQueue({
  label,
  rows,
  selected,
  onSelect,
}: {
  label: string;
  rows: readonly QueueRow[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section
      aria-label={label}
      className="flex min-w-0 flex-[1_1_300px] flex-col overflow-hidden rounded-card border border-line bg-white lg:max-w-[360px]"
    >
      {rows.length === 0 && <p className="m-0 px-4 py-4 text-small text-ink-500">Antrean ini kosong.</p>}
      <ul className="m-0 list-none p-0">
        {rows.map(({ rx, tag }) => {
          const sel = rx.id === selected;
          return (
            <li key={rx.id}>
              <button
                type="button"
                aria-pressed={sel}
                onClick={() => onSelect(rx.id)}
                className={cx(
                  'grid min-h-11 w-full cursor-pointer grid-cols-[4px_minmax(0,1fr)_auto] gap-2.5 border-0 border-b border-line-soft py-2.5 pr-3.5 text-left font-[inherit] text-inherit',
                  sel ? 'bg-selected' : 'bg-white',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'self-stretch',
                    sel ? 'bg-brand-600' : rx.cito ? 'bg-danger' : 'bg-transparent',
                  )}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold">{rx.patient.name}</span>
                  <span className="text-[12.5px] text-ink-500">
                    {rx.location} · {rx.items.length} item{rx.prb ? ` · PRB ${rx.days} hari` : ''}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span
                    className={cx(
                      'rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
                      TONE_CHIP[tag.tone],
                    )}
                  >
                    {tag.label}
                  </span>
                  <span className="font-mono text-caption text-ink-500">
                    <span className="sr-only">Resep ditulis </span>
                    {formatJam(rx.writtenAt)}
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
