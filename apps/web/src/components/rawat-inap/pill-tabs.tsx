'use client';

import { cx } from '@simrs/ui';
import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { pillTabIds, pillTabTarget } from './pill-tabs-model';

/**
 * Tab pil (mockup Ranap/BedManagement): pola tab ARIA (`tablist`/`tab`, `aria-selected`, satu tab dalam urutan
 * Tab), panah kiri/kanan + Home/End berpindah dan langsung memilih, target sentuh 44 px, dan membungkus di layar
 * sempit (tanpa scroll horizontal di 768 px). Dengan `idBase`, tiap tab menunjuk panelnya (`aria-controls`); panel
 * dirender pemanggil dengan `PillTabPanel` (idBase sama).
 */
export function PillTabs({
  items,
  value,
  onChange,
  label,
  idBase,
}: {
  items: ReadonlyArray<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
  label: string;
  idBase?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = Math.max(
    0,
    items.findIndex((t) => t.id === value),
  );
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = pillTabTarget(e.key, active, items.length);
    const item = next === null ? undefined : items[next];
    if (next === null || !item) return;
    e.preventDefault();
    onChange(item.id);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="flex flex-wrap gap-1 self-start rounded-[12px] bg-line-soft p-1"
    >
      {items.map((t, i) => {
        const selected = i === active;
        const ids = idBase ? pillTabIds(idBase, t.id) : null;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={ids?.tab}
            aria-selected={selected}
            aria-controls={ids?.panel}
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

/** Panel tab aktif: `role="tabpanel"`, berlabel tabnya, bisa difokus (konten bisa tanpa elemen interaktif). */
export function PillTabPanel({
  idBase,
  value,
  children,
  className,
}: {
  idBase: string;
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const ids = pillTabIds(idBase, value);
  return (
    <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} tabIndex={0} className={className}>
      {children}
    </div>
  );
}
