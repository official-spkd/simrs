import { cx } from '@simrs/ui';
import { STEP } from './pelangi';

/**
 * Penanda tahap alur kerja penunjang (bank darah, mikrobiologi, diagnostik, …): tahap selesai bertanda ✓, tahap
 * aktif ditandai `aria-current="step"`; status selalu berupa teks, tidak hanya warna.
 */
export function StageSteps({
  steps,
  current,
  label,
}: {
  steps: ReadonlyArray<{ id: string; label: string }>;
  current: string;
  label: string;
}) {
  const idx = steps.findIndex((s) => s.id === current);
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {steps.map((s, i) => {
        const done = i < idx || (i === idx && i === steps.length - 1);
        const active = i === idx && !done;
        return (
          <li
            key={s.id}
            aria-current={active ? 'step' : undefined}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-semibold',
              done && STEP.done,
              active && STEP.active,
              !done && !active && STEP.todo,
            )}
          >
            <span aria-hidden="true">{done ? '✓' : `${i + 1}.`}</span>
            {s.label}
            <span className="sr-only">{done ? ' (selesai)' : active ? ' (tahap aktif)' : ' (belum)'}</span>
          </li>
        );
      })}
    </ol>
  );
}
