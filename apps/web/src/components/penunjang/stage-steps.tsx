import { cx } from '@simrs/ui';

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
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption font-semibold',
              done && 'border-success-border bg-success-bg text-success',
              active && 'border-brand-600 bg-brand-50 text-brand-700',
              !done && !active && 'border-line bg-white text-ink-500',
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
