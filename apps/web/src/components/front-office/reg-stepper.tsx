import { cx, Icon } from '@simrs/ui';

export interface RegStepView {
  label: string;
  note: string;
  state: 'selesai' | 'aktif' | 'belum';
}

/** F03 · Stepper pendaftaran (Pasien → Penjamin → Tujuan → Konfirmasi); langkah aktif `aria-current="step"`. */
export function RegStepper({ steps }: { steps: RegStepView[] }) {
  return (
    <ol aria-label="Langkah pendaftaran" className="m-0 flex list-none flex-wrap gap-2.5 p-0">
      {steps.map((s, i) => (
        <li
          key={s.label}
          aria-current={s.state === 'aktif' ? 'step' : undefined}
          className={cx(
            'flex min-w-[180px] flex-1 items-center gap-2.5 rounded-control px-3 py-2',
            s.state === 'aktif'
              ? 'bg-btn-primary text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]'
              : s.state === 'selesai'
                ? 'bg-zamrud-100 text-zamrud-700'
                : 'bg-ink-900/5 text-ink-700',
          )}
        >
          <span
            aria-hidden="true"
            className={cx(
              'flex size-7 flex-none items-center justify-center rounded-full text-small font-bold',
              s.state === 'selesai'
                ? 'bg-white/80 text-zamrud-700'
                : s.state === 'aktif'
                  ? 'bg-white/20 text-white'
                  : 'bg-white/80 text-ink-500',
            )}
          >
            {s.state === 'selesai' ? <Icon name="check" size={14} strokeWidth={2.6} /> : i + 1}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-small font-semibold">
              {s.label}
              <span className="sr-only">
                {s.state === 'selesai' ? ' (selesai)' : s.state === 'aktif' ? ' (langkah aktif)' : ' (belum)'}
              </span>
            </span>
            <span
              className={cx(
                'truncate text-caption',
                s.state === 'aktif'
                  ? 'text-white/90'
                  : s.state === 'selesai'
                    ? 'text-zamrud-700'
                    : 'text-ink-500',
              )}
            >
              {s.note}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
