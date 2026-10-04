'use client';

import { cx } from '@simrs/ui';
import { type KeyboardEvent, useRef } from 'react';

/**
 * Tab pil (mockup Ranap/BedManagement): semantik tab ARIA, panah kiri/kanan berpindah, target sentuh 44 px, dan
 * membungkus di layar sempit (tanpa scroll horizontal di 768 px). Panel diatur pemanggil.
 */
export function PillTabs({
  items,
  value,
  onChange,
  label,
}: {
  items: ReadonlyArray<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = Math.max(
    0,
    items.findIndex((t) => t.id === value),
  );
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (active + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    const item = items[next];
    if (!item) return;
    onChange(item.id);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex flex-wrap gap-1 self-start rounded-[12px] bg-line-soft p-1"
    >
      {items.map((t, i) => {
        const selected = i === active;
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
            onClick={() => onChange(t.id)}
            className={cx(
              'min-h-11 cursor-pointer rounded-[9px] border-0 px-3.5 font-[inherit] text-small',
              selected ? 'bg-white font-semibold text-brand-700 shadow-tab' : 'bg-transparent text-ink-700',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
