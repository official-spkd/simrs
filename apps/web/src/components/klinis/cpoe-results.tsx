import type { EncounterLab } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { LAB_FLAG_LABEL } from '@/lib/klinis';

/** Hasil penunjang terbaru di samping order (nilai kritis/abnormal ditandai teks, bukan hanya warna). */
export function CpoeResults({ results }: { results: readonly EncounterLab[] }) {
  if (results.length === 0) return null;
  return (
    <section
      aria-label="Hasil penunjang terbaru"
      className="flex flex-col gap-2.5 rounded-card border border-line bg-white px-4 py-3.5 shadow-card"
    >
      <h2 className="m-0 text-body font-semibold">Hasil penunjang terbaru</h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {results.map((r) => (
          <li key={`${r.name}-${r.value}`} className="flex flex-col gap-0.5 text-small">
            <span className="flex items-baseline justify-between gap-2">
              <span>{r.name}</span>
              <span
                className={cx(
                  'text-right font-bold',
                  r.flag === 'K' || r.flag === 'H' || r.flag === 'A' ? 'text-danger' : 'text-ink-900',
                )}
              >
                {r.value}
                {r.flag && (
                  <span
                    className={cx('ml-1 text-caption', r.flag === 'K' && 'rounded bg-danger px-1 text-white')}
                  >
                    {LAB_FLAG_LABEL[r.flag]}
                  </span>
                )}
              </span>
            </span>
            <span className="text-caption text-ink-500">
              {r.reference ? `Rujukan ${r.reference}` : '—'}
              {r.loinc && <span className="font-mono"> · LOINC {r.loinc}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
