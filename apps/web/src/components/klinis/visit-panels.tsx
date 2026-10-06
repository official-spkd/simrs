import type { PoliVital } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { stageSteps, vitalValueFlag } from '@/lib/klinis';
import { VALUE_FLAG_STYLE, ValueFlagBadge } from './status-flag';

/** Tahapan kunjungan rawat jalan (mockup Main: Registrasi → Kasir). */
export function VisitStepper({ stage }: { stage: number }) {
  return (
    <ol
      aria-label="Tahapan kunjungan"
      className="m-0 flex list-none flex-wrap items-center gap-1.5 rounded-card border border-white/95 bg-white/90 px-4 py-3 shadow-card"
    >
      {stageSteps(stage).map((s, i) => (
        <li
          key={s.label}
          aria-current={s.state === 'aktif' ? 'step' : undefined}
          className="flex min-w-[112px] flex-[1_1_112px] items-center gap-2"
        >
          <span
            aria-hidden="true"
            className={cx(
              'flex size-6 flex-none items-center justify-center rounded-full border text-caption font-bold',
              s.state === 'selesai' && 'border-zamrud-200 bg-zamrud-100 text-zamrud-800',
              s.state === 'aktif' &&
                'border-transparent bg-nav-active text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]',
              s.state === 'belum' && 'border-line-strong bg-white text-ink-500',
            )}
          >
            {s.state === 'selesai' ? '✓' : i + 1}
          </span>
          <span
            className={cx('text-small', s.state === 'aktif' ? 'font-semibold text-ink-900' : 'text-ink-700')}
          >
            {s.label}
            <span className="sr-only">
              {s.state === 'selesai' ? ' (selesai)' : s.state === 'aktif' ? ' (tahap saat ini)' : ' (belum)'}
            </span>
          </span>
          <span aria-hidden="true" className="h-px min-w-2 flex-1 bg-line" />
        </li>
      ))}
    </ol>
  );
}

/** Ubin tanda vital; nilai di luar batas ditandai warna DAN teks + ikon arah ("↑ Tinggi", "↓ Rendah"). */
export function VitalTiles({ vitals }: { vitals: readonly PoliVital[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
      {vitals.map((v) => {
        const flag = vitalValueFlag(v.flag);
        return (
          <div
            key={v.id}
            className={cx(
              'flex min-w-0 flex-col gap-0.5 rounded-control border px-3 py-2.5',
              flag ? VALUE_FLAG_STYLE[flag].tile : 'border-line-soft bg-subtle',
            )}
          >
            <span className="flex flex-wrap items-center justify-between gap-1 text-caption text-ink-500">
              {v.label}
              {flag && <ValueFlagBadge flag={flag} />}
            </span>
            <span
              className={cx('text-[19px] font-bold', flag ? VALUE_FLAG_STYLE[flag].text : 'text-ink-900')}
            >
              {v.value} <span className="text-caption font-normal text-ink-500">{v.unit}</span>
            </span>
            <span className="text-caption text-ink-500">{v.note}</span>
          </div>
        );
      })}
    </div>
  );
}
