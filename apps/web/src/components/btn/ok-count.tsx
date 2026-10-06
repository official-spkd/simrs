'use client';

import type { OrCase } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { checkCounts, currentPhase } from '@/lib/btn-ok';

/** Hitung kasa, jarum, dan instrumen: hitung awal tercatat; hitung akhir diisi saat sign out dan harus cocok. */
export function OkCount({
  c,
  busy,
  onChange,
}: {
  c: OrCase;
  busy: boolean;
  onChange: (countId: string, value: number | null) => void;
}) {
  const cur = currentPhase(c.checklist);
  const signedOut = !!c.checklist[2]?.confirmedAt;
  const open = cur === 2 && !signedOut;
  const check = checkCounts(c.counts);
  let text = 'Kolom: awal · akhir (diisi saat sign out).';
  let tone: 'muted' | 'danger' | 'success' = 'muted';
  if (signedOut) {
    text = 'Hitung akhir cocok dengan hitung awal · tercatat saat sign out.';
    tone = 'success';
  } else if (open && check.mismatches.length) {
    text = `Tidak cocok: ${check.mismatches.join(', ')}. Hitung ulang sebelum sign out.`;
    tone = 'danger';
  } else if (open && !check.ok) {
    text = `Isi hitung akhir (${check.filled}/${check.total} terisi). Sign out butuh semua cocok.`;
  } else if (open) {
    text = 'Semua hitungan cocok dengan hitung awal.';
    tone = 'success';
  }
  return (
    <section
      aria-label="Hitung kasa dan instrumen"
      className="flex flex-col gap-2.5 rounded-card border border-line bg-white p-4"
    >
      <span className="font-semibold">Hitung kasa dan instrumen</span>
      <div className="grid grid-cols-[1fr_auto_88px_20px] items-center gap-x-2.5 gap-y-1.5 text-small">
        <span className="text-caption text-ink-500">Item</span>
        <span className="text-caption text-ink-500">Awal</span>
        <span className="text-caption text-ink-500">Akhir</span>
        <span aria-hidden="true" />
        {c.counts.map((x) => {
          const has = x.final !== null;
          const match = has && x.final === x.initial;
          return (
            <div key={x.id} className="contents">
              <label htmlFor={`hitung-${c.id}-${x.id}`}>{x.label}</label>
              <span className="text-right font-mono">
                {x.initial} {x.unit === 'set' ? 'set' : ''}
              </span>
              <input
                id={`hitung-${c.id}-${x.id}`}
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="—"
                disabled={!open || busy}
                value={x.final ?? ''}
                aria-invalid={has && !match}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  onChange(x.id, v === '' ? null : Math.max(0, Math.floor(Number(v)) || 0));
                }}
                className={cx(
                  'h-11 w-full rounded-control border px-2 text-right font-mono disabled:bg-subtle',
                  has ? (match ? 'border-[#7BC08F]' : 'border-danger') : 'border-line-strong',
                )}
              />
              <span aria-hidden="true" className={cx('font-bold', match ? 'text-success' : 'text-danger')}>
                {has ? (match ? '✓' : '✕') : ''}
              </span>
            </div>
          );
        })}
      </div>
      <span
        aria-live="polite"
        className={cx(
          'text-small',
          tone === 'danger' && 'font-semibold text-danger',
          tone === 'success' && 'font-semibold text-success',
          tone === 'muted' && 'text-ink-700',
        )}
      >
        {text}
      </span>
    </section>
  );
}
