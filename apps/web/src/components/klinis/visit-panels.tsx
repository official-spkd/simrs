import type { PoliVital } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { stageSteps, VITAL_FLAG_LABEL } from '@/lib/klinis';

/** Tahapan kunjungan rawat jalan (mockup Main: Registrasi → Kasir). */
export function VisitStepper({ stage }: { stage: number }) {
  return (
    <ol
      aria-label="Tahapan kunjungan"
      className="m-0 flex list-none flex-wrap items-center gap-1.5 rounded-[12px] border border-line bg-white px-4 py-3"
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
              s.state === 'selesai' && 'border-brand-200 bg-brand-50 text-brand-700',
              s.state === 'aktif' && 'border-brand-600 bg-brand-600 text-white',
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

/** Ubin tanda vital; nilai di luar batas ditandai warna DAN teks ("Tinggi"). */
export function VitalTiles({ vitals }: { vitals: readonly PoliVital[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
      {vitals.map((v) => {
        const abnormal = v.flag === 'tinggi' || v.flag === 'rendah';
        return (
          <div
            key={v.id}
            className={cx(
              'flex min-w-0 flex-col gap-0.5 rounded-control border px-3 py-2.5',
              abnormal
                ? 'border-danger-border bg-[linear-gradient(180deg,#FEF3F2,#FFFFFF)]'
                : 'border-line-soft bg-subtle',
            )}
          >
            <span className="flex items-center justify-between gap-1 text-caption text-ink-500">
              {v.label}
              {abnormal && (
                <span className="rounded-full bg-danger-bg px-1.5 text-[11px] font-bold text-danger">
                  {VITAL_FLAG_LABEL[v.flag]}
                </span>
              )}
            </span>
            <span className={cx('text-[19px] font-bold', abnormal ? 'text-danger' : 'text-ink-900')}>
              {v.value} <span className="text-caption font-normal text-ink-500">{v.unit}</span>
            </span>
            <span className="truncate text-caption text-ink-500">{v.note}</span>
          </div>
        );
      })}
    </div>
  );
}
