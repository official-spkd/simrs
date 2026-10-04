'use client';

import { type KeyboardEvent, useRef } from 'react';
import { cx } from './cx';

export interface SegmentedItem {
  id: string;
  label: string;
}

/**
 * Kontrol segmen (pil abu-abu, pilihan aktif putih) untuk berpindah tampilan setara, mis. skenario simulasi atau
 * rentang dasbor. Semantik tab ARIA; panah kiri/kanan berpindah pilihan. Tanpa panel: konten diatur pemanggil.
 */
export function Segmented({
  items,
  value,
  onChange,
  label,
  disabled,
}: {
  items: readonly SegmentedItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(
    0,
    items.findIndex((t) => t.id === value),
  );

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    const next = (activeIndex + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    const item = items[next];
    if (!item) return;
    onChange(item.id);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex flex-wrap gap-1 rounded-[12px] bg-[#EEF1F4] p-1"
    >
      {items.map((t, i) => {
        const selected = i === activeIndex;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => !selected && onChange(t.id)}
            className={cx(
              'h-9 cursor-pointer rounded-[9px] border-0 px-3.5 text-small font-[inherit] disabled:cursor-not-allowed',
              selected
                ? 'bg-white font-semibold text-ink-900 shadow-[0_1px_2px_rgba(16,24,40,0.08)]'
                : 'bg-transparent text-ink-700',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
