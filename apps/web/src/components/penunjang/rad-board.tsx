import type { RadiologyModality } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { MODALITY_STATUS, slotView } from '@/lib/penunjang-radiologi';
import { TONE_CHIP } from './lab-worklist';

/** Papan modalitas (CT, DR, USG, MRI, angiografi): status alat dan okupansi slot hari ini. */
export function RadBoard({ modalities }: { modalities: readonly RadiologyModality[] }) {
  return (
    <section aria-label="Papan modalitas" className="flex flex-col gap-2.5">
      <h2 className="m-0 text-body font-semibold">Papan modalitas · slot hari ini</h2>
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-5">
        {modalities.map((m) => {
          const slot = slotView(m);
          const st = MODALITY_STATUS[m.status];
          return (
            <li
              key={m.modality}
              className="flex flex-col gap-2 rounded-card border border-line bg-white px-4 py-3"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">{m.name}</span>
                  <span className="text-caption text-ink-500">{m.room}</span>
                </span>
                <span
                  className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', TONE_CHIP[st.tone])}
                >
                  {st.label}
                </span>
              </span>
              <span className="flex items-baseline justify-between gap-2 text-small">
                <span className="font-mono font-semibold">{slot.text}</span>
                <span className="text-caption text-ink-500">
                  {m.nextSlot ? `slot kosong berikutnya ${m.nextSlot}` : 'penuh hari ini'}
                </span>
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span
                  className={cx('block h-1.5', slot.percent >= 90 ? 'bg-warning' : 'bg-brand-600')}
                  style={{ width: `${slot.percent}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
