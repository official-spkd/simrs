'use client';

import { cx } from '@simrs/ui';
import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';

export interface KeepTab {
  id: string;
  label: string;
  /** Lencana kecil (mis. "3 selisih"); `warn` = merah. */
  badge?: string;
  warn?: boolean;
  content: ReactNode;
}

/**
 * Tab ARIA bergaya segmen (mockup PembayaranBTN/PembiayaanBTN) yang menjaga semua panel tetap terpasang: pindah tab
 * tidak menghapus isian yang belum disimpan. Panah kiri/kanan berpindah tab.
 */
export function KeepTabs({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly KeepTab[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const base = useId();
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
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-1 self-start rounded-[12px] bg-[#EEF1F4] p-1"
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
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cx(
                'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[9px] border-0 px-3.5 font-[inherit] text-small',
                selected
                  ? 'bg-white font-semibold text-brand-700 shadow-[0_1px_2px_rgba(20,33,43,0.12)]'
                  : 'bg-transparent font-medium text-ink-700',
              )}
            >
              {t.label}
              {t.badge && (
                <span
                  className={cx(
                    'rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
                    t.warn ? 'bg-danger-bg text-danger' : 'bg-brand-50 text-brand-700',
                  )}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {items.map((t, i) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={i !== active}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
