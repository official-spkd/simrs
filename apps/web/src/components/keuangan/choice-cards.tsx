'use client';

import { cx } from '@simrs/ui';
import { type ReactNode, useId } from 'react';

export interface ChoiceOption<T extends string> {
  id: T;
  label: ReactNode;
  sub?: ReactNode;
  disabled?: boolean;
  /** Kelas tambahan kartu (mis. `col-span-2`). */
  className?: string;
}

/**
 * Pilihan berbentuk kartu dari radio asli (`fieldset` + `input type="radio"` di dalam `label`): Tab masuk sekali ke
 * grup, tombol panah memindahkan pilihan, Spasi memilih, dan status terpilih/nonaktif terbaca pembaca layar tanpa
 * ARIA buatan. Fokus keyboard tampil sebagai garis tepi kartu.
 */
export function ChoiceCards<T extends string>({
  legend,
  showLegend = false,
  options,
  value,
  onChange,
  className,
  compact = false,
}: {
  legend: string;
  /** Tampilkan legend sebagai judul terlihat (bawaan: hanya untuk pembaca layar). */
  showLegend?: boolean;
  options: ReadonlyArray<ChoiceOption<T>>;
  value: T | null;
  onChange: (id: T) => void;
  /** Tata letak kartu (grid/flex). */
  className?: string;
  compact?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className={showLegend ? 'mb-1 p-0 text-small font-semibold' : 'sr-only'}>{legend}</legend>
      <div className={className}>
        {options.map((o) => {
          const on = value === o.id;
          return (
            <label
              key={o.id}
              className={cx(
                'relative flex min-h-11 flex-col gap-0.5 border-[1.5px] text-left text-ink-900',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600',
                compact ? 'rounded-[9px] px-2 py-1.5' : 'rounded-control px-3 py-2',
                on ? 'border-brand-600 bg-[#F2FAF8]' : 'border-line bg-white',
                o.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                o.disabled && !on && 'opacity-60',
                o.className,
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.id}
                checked={on}
                disabled={o.disabled}
                onChange={() => onChange(o.id)}
                className="sr-only"
              />
              <span className="font-semibold">{o.label}</span>
              {o.sub && <span className="text-[11.5px] text-ink-500">{o.sub}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
