'use client';

import { type KeyboardEvent, useRef } from 'react';
import { cx } from './cx';
import { SEGMENT_GROUP, SEGMENT_ITEM, SEGMENT_OFF, SEGMENT_ON } from './segment-style';
import { radioKeyTarget } from './tabs-model';

export interface SegmentedItem {
  id: string;
  label: string;
}

/**
 * Kontrol segmen untuk MEMILIH satu nilai/mode (rentang dasbor, mode koneksi, kanal pembayaran): pola radio ARIA
 * (`radiogroup`/`radio`, `aria-checked`, satu pilihan dalam urutan Tab; panah kiri/kanan/atas/bawah memindah dan
 * memilih, berputar di ujung). Tampak ringkas 36 px, area sentuh 44 px. Untuk berpindah panel konten, pakai
 * `TabList variant="segmen"` + `TabPanel`.
 */
export function RadioSegmented({
  items,
  value,
  onChange,
  label,
  disabled = false,
  className,
}: {
  items: readonly SegmentedItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const checked = items.findIndex((t) => t.id === value);
  const focusable = Math.max(0, checked);
  const pick = (i: number) => {
    const item = items[i];
    if (item && item.id !== value) onChange(item.id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = radioKeyTarget(e.key, focusable, items.length);
    if (next === null) return;
    e.preventDefault();
    pick(next);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cx(SEGMENT_GROUP, className)}
    >
      {items.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === checked}
          tabIndex={i === focusable ? 0 : -1}
          disabled={disabled}
          onClick={() => pick(i)}
          className={cx(
            'cursor-pointer font-[inherit] text-small disabled:cursor-not-allowed',
            SEGMENT_ITEM,
            i === checked ? SEGMENT_ON : SEGMENT_OFF,
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
