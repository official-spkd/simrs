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
            'flex min-w-[180px] flex-1 items-center gap-2.5 rounded-control border px-3 py-2',
            s.state === 'aktif'
              ? 'border-brand-600 bg-[linear-gradient(90deg,var(--color-brand-50),#FFFFFF)]'
              : 'border-line bg-white',
          )}
        >
          <span
            aria-hidden="true"
            className={cx(
              'flex size-7 flex-none items-center justify-center rounded-full text-small font-bold',
              s.state === 'selesai'
                ? 'bg-brand-50 text-brand-700'
                : s.state === 'aktif'
                  ? 'bg-brand-600 text-white'
                  : 'bg-muted text-ink-500',
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
            <span className="truncate text-caption text-ink-500">{s.note}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
