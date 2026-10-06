import type { EncounterLab } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { labValueFlag } from '@/lib/klinis';
import { VALUE_FLAG_STYLE, ValueFlagBadge } from './status-flag';

/** Hasil penunjang terbaru di samping order (nilai di luar rentang ditandai teks + ikon, bukan hanya warna). */
export function CpoeResults({ results }: { results: readonly EncounterLab[] }) {
  if (results.length === 0) return null;
  return (
    <section
      aria-label="Hasil penunjang terbaru"
      className="flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5"
    >
      <h2 className="m-0 text-body font-semibold">Hasil penunjang terbaru</h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {results.map((r) => {
          const flag = labValueFlag(r.flag);
          return (
            <li key={`${r.name}-${r.value}`} className="flex flex-col gap-0.5 text-small">
              <span className="flex items-baseline justify-between gap-2">
                <span>{r.name}</span>
                <span
                  className={cx(
                    'inline-flex flex-wrap items-center justify-end gap-1 text-right font-bold',
                    flag ? VALUE_FLAG_STYLE[flag].text : 'text-ink-900',
                  )}
                >
                  {r.value}
                  {flag && <ValueFlagBadge flag={flag} />}
                </span>
              </span>
              <span className="text-caption text-ink-500">
                {r.reference ? `Rujukan ${r.reference}` : '—'}
                {r.loinc && <span className="font-mono"> · LOINC {r.loinc}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
