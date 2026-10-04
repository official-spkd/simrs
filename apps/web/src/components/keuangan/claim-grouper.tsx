import { formatRupiah } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { claimRatio, type GrouperTileView } from '@/lib/keuangan-klaim';

/**
 * Hasil grouper INA-CBG (simulasi) dan perbandingan tarif RS vs INA-CBG (bigint). Status juga dalam teks (persen,
 * "melebihi"/"di bawah"), bukan hanya warna batang.
 */
export function ClaimGrouper({
  tiles,
  hospitalCost,
  tariff,
  classLabel,
  held,
}: {
  tiles: readonly GrouperTileView[];
  hospitalCost: string | null;
  tariff: string | null;
  classLabel: string;
  /** Alasan grouping ditahan (null = ada hasil grouper). */
  held: string | null;
}) {
  const ratio = claimRatio(hospitalCost, tariff);
  return (
    <section
      aria-label="Hasil grouper"
      className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-white bg-[linear-gradient(160deg,#FFFFFF_60%,rgba(15,118,110,0.06))] p-4"
    >
      <span className="font-semibold">Hasil grouper INA-CBG (simulasi)</span>
      {held && (
        <span
          role="status"
          className="rounded-control border border-warning-border bg-[#FFFAF2] px-3 py-2 text-small text-warning"
        >
          Grouping ditahan: {held}
        </span>
      )}
      <div aria-live="polite" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {tiles.map((g) => (
          <span
            key={g.k}
            className={cx(
              'flex min-w-0 flex-col rounded-control border border-line px-3 py-2.5',
              g.tone === 'warn' ? 'bg-[#FFFAF2]' : g.tone === 'ok' ? 'bg-[#EAF5EC]' : 'bg-white',
            )}
          >
            <span className="text-caption text-ink-500">{g.k}</span>
            <span
              className={cx(
                'font-mono text-[15px] font-semibold',
                g.tone === 'warn' ? 'text-warning' : g.tone === 'ok' ? 'text-success' : 'text-ink-900',
              )}
            >
              {g.v}
            </span>
            <span className="text-caption text-ink-700">{g.s}</span>
          </span>
        ))}
      </div>
      {ratio && (
        <div className="flex flex-col gap-1.5">
          <span className="flex justify-between text-[12.5px] text-ink-700">
            <span>Tarif RS vs INA-CBG {classLabel}</span>
            <span className="font-mono">{ratio.percent}%</span>
          </span>
          <span className="flex h-2 overflow-hidden rounded-full bg-[#EEF1F4]" aria-hidden="true">
            <span className="bg-brand-600" style={{ width: `${ratio.cbgWidth}%` }} />
            <span className="bg-[#F4C98E]" style={{ width: `${100 - ratio.cbgWidth}%` }} />
          </span>
          <span className="text-caption text-ink-500">
            {ratio.overrun
              ? `Tarif RS melebihi INA-CBG ${formatRupiah(ratio.gap)}; selisih dicatat untuk analisis clinical pathway.`
              : `Tarif RS di bawah INA-CBG; margin kasus positif ${formatRupiah(-ratio.gap)}.`}
          </span>
        </div>
      )}
    </section>
  );
}
