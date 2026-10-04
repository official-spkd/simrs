import type { LabResult } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { type FlagView, flagView, formatRange, resultText, sparkPoints, trendText } from '@/lib/penunjang';

/**
 * Tabel hasil laboratorium (mockup Lab): kode LOINC, nilai, satuan, rujukan, flag H/L/KRITIS/Δ, dan tren kecil.
 * Responsif terhadap lebar kartu (container query): kolom sekunder dilipat ke kolom pemeriksaan pada kartu sempit.
 */

const VALUE_TONE: Record<FlagView['tone'], string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  neutral: 'text-ink-900',
};
const CHIP_TONE: Record<FlagView['tone'], string> = {
  danger: 'bg-danger-bg text-danger',
  warning: 'bg-warning-bg text-warning',
  neutral: 'bg-muted text-ink-700',
};
const STROKE: Record<FlagView['tone'], string> = {
  danger: '#B42318',
  warning: '#8A4B00',
  neutral: '#0F766E',
};

function Sparkline({ r, tone }: { r: LabResult; tone: FlagView['tone'] }) {
  if (r.value === null || r.pending) return null;
  const pts = sparkPoints([...r.previous, r.value], 56, 18);
  if (!pts) return null;
  return (
    <svg width={56} height={18} viewBox="0 0 56 18" aria-hidden="true" className="flex-none">
      <polyline
        points={pts}
        fill="none"
        stroke={STROKE[tone]}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LabResultsTable({ results, caption }: { results: readonly LabResult[]; caption: string }) {
  return (
    <table className="w-full border-collapse text-small">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line bg-subtle text-left text-caption text-ink-500">
          <th scope="col" className="px-4 py-2 font-semibold">
            Pemeriksaan
          </th>
          <th scope="col" className="px-2 py-2 font-semibold">
            Hasil
          </th>
          <th scope="col" className="hidden px-2 py-2 font-semibold @xl:table-cell">
            Satuan
          </th>
          <th scope="col" className="hidden px-2 py-2 font-semibold @lg:table-cell">
            Rujukan
          </th>
          <th scope="col" className="px-2 py-2 font-semibold">
            Flag
          </th>
          <th scope="col" className="hidden px-4 py-2 font-semibold @2xl:table-cell">
            Tren 3 hari
          </th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => {
          const f = flagView(r);
          const ref = formatRange(r.ref, r.decimals);
          const trend = trendText(r);
          return (
            <tr
              key={r.loinc}
              className={cx(
                'border-b border-line-soft align-middle',
                r.flag === 'KRITIS' ? 'bg-[#FFF5F4]' : r.delta ? 'bg-[#FFFAF2]' : 'bg-white',
              )}
            >
              <th scope="row" className="px-4 py-2 text-left font-normal">
                <span className="flex flex-col">
                  <span className="font-medium text-ink-900">{r.name}</span>
                  <span className="font-mono text-[11.5px] text-ink-500">LOINC {r.loinc}</span>
                  {r.note && <span className="text-[11.5px] text-ink-700">{r.note}</span>}
                  <span className="text-[11.5px] text-ink-500 @lg:hidden">Rujukan {ref}</span>
                  {trend !== '—' && (
                    <span className="text-[11.5px] text-ink-500 @2xl:hidden">Tren: {trend}</span>
                  )}
                </span>
              </th>
              <td
                className={cx(
                  'px-2 py-2 font-mono font-semibold',
                  r.pending ? 'text-ink-500' : VALUE_TONE[f.tone],
                )}
              >
                {resultText(r)}
                {r.unit !== '—' && (
                  <span className="font-sans font-normal text-ink-700 @xl:hidden"> {r.unit}</span>
                )}
              </td>
              <td className="hidden px-2 py-2 text-ink-700 @xl:table-cell">{r.unit}</td>
              <td className="hidden px-2 py-2 font-mono text-ink-700 @lg:table-cell">{ref}</td>
              <td className="px-2 py-2">
                <span
                  className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', CHIP_TONE[f.tone])}
                >
                  <span aria-hidden="true">{f.label}</span>
                  <span className="sr-only">{f.sr}</span>
                </span>
              </td>
              <td className="hidden px-4 py-2 @2xl:table-cell">
                <span className="flex items-center gap-2 font-mono text-caption text-ink-500">
                  <Sparkline r={r} tone={f.tone} />
                  {trend}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
