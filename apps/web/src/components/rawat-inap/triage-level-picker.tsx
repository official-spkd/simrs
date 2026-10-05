'use client';

import { TRIAGE_LEVELS, type TriageLevel } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useId } from 'react';
import { TRIAGE_META } from '@/lib/rawat-inap';

/**
 * Pilihan level triase 1–5 (radio asli, panah kiri/kanan berpindah). Level di atas `maxLevel` dikunci protokol
 * dengan alasan tertulis; saran sistem ditandai teks, bukan hanya warna.
 */
export function TriageLevelPicker({
  value,
  suggested,
  maxLevel,
  disabled,
  lockReason,
  onChange,
}: {
  value: TriageLevel;
  suggested: TriageLevel;
  maxLevel: TriageLevel;
  disabled?: boolean;
  lockReason?: string;
  onChange: (level: TriageLevel) => void;
}) {
  const name = useId();
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0" disabled={disabled}>
      <legend className="mb-1.5 p-0 text-small font-semibold">Level triase</legend>
      {/* Panel sempit (< 24rem, mis. panel IGD di laptop): 3 kolom agar "Emergensi · saran" tidak terjepit. */}
      <div className="@container">
        <div className="grid grid-cols-3 gap-1.5 @sm:grid-cols-5">
          {TRIAGE_LEVELS.map((n) => {
            const m = TRIAGE_META[n];
            const locked = n > maxLevel;
            const on = n === value;
            return (
              <label
                key={n}
                className={cx(
                  'relative flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-control px-1 py-2 text-center',
                  on ? m.selected : 'border border-line-strong bg-white text-ink-700',
                  locked || disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={n}
                  checked={on}
                  disabled={locked || disabled}
                  aria-label={`Level ${n} · ${m.label}${n === suggested ? ' (saran sistem)' : ''}${locked ? ' (dikunci protokol)' : ''}`}
                  onChange={() => onChange(n)}
                  className="sr-only"
                />
                <span className="text-[18px] leading-none font-bold">{n}</span>
                <span className="text-[11px] leading-tight font-semibold">{m.label}</span>
                {n === suggested && (
                  <span className="text-[10.5px] leading-tight font-semibold underline decoration-dotted">
                    saran
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>
      {maxLevel < 5 && (
        <span className="text-caption text-ink-500">
          Level {maxLevel + 1}–5 dikunci: {lockReason ?? 'protokol klinis kasus ini'}.
        </span>
      )}
    </fieldset>
  );
}
