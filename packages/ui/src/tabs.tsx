'use client';

import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import { cx } from './cx';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

/** Tab ARIA: panah kiri/kanan berpindah tab; tab aktif ditandai garis teal + teks tebal. */
export function Tabs({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(
    0,
    items.findIndex((t) => t.id === value),
  );
  const active = items[activeIndex];

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (activeIndex + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    const item = items[next];
    if (!item) return;
    onChange(item.id);
    refs.current[next]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex border-b border-line" onKeyDown={onKeyDown}>
        {items.map((t, i) => {
          const selected = t.id === active?.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cx(
                '-mb-px h-11 cursor-pointer border-0 border-b-2 bg-transparent px-3.5 text-small font-[inherit]',
                selected
                  ? 'border-brand-600 font-semibold text-brand-700'
                  : 'border-transparent text-ink-700',
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {active && (
        <div
          role="tabpanel"
          id={`${base}-panel`}
          aria-labelledby={`${base}-tab-${active.id}`}
          className="pt-3"
        >
          {active.content}
        </div>
      )}
    </div>
  );
}
