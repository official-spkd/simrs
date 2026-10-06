import type { AgingRow } from '@simrs/shared';
import { AGING_LABELS, agingView, formatJuta } from '@/lib/keuangan-akuntansi';

const COLORS = ['bg-brand-600', 'bg-brand-300', 'bg-kunyit-300', 'bg-koral-500'] as const;

/** Umur piutang per penjamin (mockup Akuntansi): total (Rp juta) dan porsi kelompok umur, juga dalam teks. */
export function AgingCard({ rows }: { rows: readonly AgingRow[] }) {
  return (
    <section
      aria-label="Umur piutang"
      className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
    >
      <span className="flex justify-between">
        <span className="font-semibold">Umur piutang</span>
        <span className="text-[12.5px] text-ink-500">Rp juta</span>
      </span>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((r) => {
          const v = agingView(r);
          return (
            <li key={r.payer} className="flex flex-col gap-1.5">
              <span className="flex justify-between gap-2 text-[13px]">
                <span className="font-medium">{r.label}</span>
                <span className="font-mono">{formatJuta(v.total)}</span>
              </span>
              <span className="flex h-2.5 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
                {v.shares.map((s, i) => (
                  <span key={AGING_LABELS[i]} className={COLORS[i]} style={{ width: `${s}%` }} />
                ))}
              </span>
              <span className="text-[11.5px] text-ink-500">
                {v.shares.map((s, i) => `${AGING_LABELS[i]} ${s}%`).join(' · ')}
              </span>
            </li>
          );
        })}
      </ul>
      <span className="flex flex-wrap gap-3 text-caption text-ink-700" aria-hidden="true">
        {AGING_LABELS.map((l, i) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <span className={`inline-block size-2.5 rounded-[2px] ${COLORS[i]}`} />
            {l}
          </span>
        ))}
      </span>
    </section>
  );
}
