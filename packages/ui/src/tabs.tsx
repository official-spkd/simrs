'use client';

import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import { cx } from './cx';
import { SEGMENT_GROUP, SEGMENT_ITEM, SEGMENT_OFF, SEGMENT_ON } from './segment-style';
import { tabIds, tabKeyTarget } from './tabs-model';

/**
 * Gaya daftar tab:
 * - `pil`: pil abu-abu, tab aktif putih (mockup Ranap, BedManagement, PembayaranBTN); tombol 44 px.
 * - `segmen`: sama dengan pil tetapi ringkas untuk baris kontrol yang berpindah panel (skenario Simulasi): tampak
 *   36 px, area sentuh diperluas ke padding wadah sehingga tetap 44 px. Memilih nilai/mode tanpa panel →
 *   `RadioSegmented`.
 * - `garis`: garis bawah teal di tab aktif (rekam medis, worklist); tombol 44 px.
 */
export type TabsVariant = 'pil' | 'segmen' | 'garis';

export interface TabListItem {
  id: string;
  label: string;
  /** Lencana kecil di samping label (mis. "3 selisih"); `danger` = merah. */
  badge?: string;
  badgeTone?: 'brand' | 'danger';
}

const LIST: Record<TabsVariant, string> = {
  pil: 'flex flex-wrap gap-1 self-start rounded-[12px] bg-[rgba(23,32,46,0.06)] p-1',
  segmen: SEGMENT_GROUP,
  garis: 'flex flex-wrap border-b border-line',
};

const TAB: Record<TabsVariant, { base: string; on: string; off: string }> = {
  pil: {
    base: 'inline-flex min-h-touch items-center gap-2 rounded-[9px] border-0 px-3.5',
    on: 'bg-white font-semibold text-brand-800 shadow-tab',
    off: 'bg-transparent text-ink-700',
  },
  segmen: { base: SEGMENT_ITEM, on: SEGMENT_ON, off: SEGMENT_OFF },
  garis: {
    base: 'inline-flex -mb-px min-h-touch items-center gap-2 border-0 border-b-2 bg-transparent px-3.5',
    on: 'border-brand-600 font-semibold text-brand-700',
    off: 'border-transparent text-ink-700',
  },
};

/**
 * Daftar tab ARIA (`tablist`/`tab`, `aria-selected`, satu tab dalam urutan Tab): panah kiri/kanan berputar,
 * Home/End ke ujung, pilihan mengikuti fokus. Membungkus di layar sempit (tanpa scroll horizontal di 768 px). Dengan
 * `idBase`, tab menunjuk panelnya (`aria-controls`) yang dirender `TabPanel` dengan `idBase` sama: semua tab bila
 * semua panel terpasang (`allPanelsMounted`), selain itu hanya tab aktif (panel tab lain belum ada di DOM).
 */
export function TabList({
  items,
  value,
  onChange,
  label,
  idBase,
  allPanelsMounted = false,
  variant = 'pil',
  disabled = false,
  className,
}: {
  items: readonly TabListItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  idBase?: string;
  allPanelsMounted?: boolean;
  variant?: TabsVariant;
  disabled?: boolean;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = Math.max(
    0,
    items.findIndex((t) => t.id === value),
  );
  const pick = (i: number) => {
    const item = items[i];
    if (item && item.id !== value) onChange(item.id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = tabKeyTarget(e.key, active, items.length);
    if (next === null) return;
    e.preventDefault();
    pick(next);
    refs.current[next]?.focus();
  };
  const style = TAB[variant];
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cx(LIST[variant], className)}
    >
      {items.map((t, i) => {
        const selected = i === active;
        const ids = idBase ? tabIds(idBase, t.id) : null;
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
            aria-controls={ids && (selected || allPanelsMounted) ? ids.panel : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => pick(i)}
            className={cx(
              'cursor-pointer font-[inherit] text-small disabled:cursor-not-allowed',
              style.base,
              selected ? style.on : style.off,
            )}
          >
            {t.label}
            {t.badge && (
              <span
                className={cx(
                  'rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
                  t.badgeTone === 'danger' ? 'bg-danger-bg text-danger' : 'bg-brand-50 text-brand-700',
                )}
              >
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Panel satu tab: `role="tabpanel"` berlabel tabnya; bisa difokus (isi panel bisa tanpa elemen interaktif). */
export function TabPanel({
  idBase,
  value,
  hidden,
  children,
  className,
}: {
  idBase: string;
  /** Id tab pemilik panel ini. */
  value: string;
  hidden?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const ids = tabIds(idBase, value);
  return (
    <div
      role="tabpanel"
      id={ids.panel}
      aria-labelledby={ids.tab}
      tabIndex={0}
      hidden={hidden}
      className={className}
    >
      {children}
    </div>
  );
}

export interface TabItem extends TabListItem {
  content: ReactNode;
}

/**
 * Tab lengkap (daftar + panel). Bawaan hanya panel aktif yang dirender; `keepMounted` memasang semua panel dan
 * menyembunyikan yang tidak aktif (`hidden`) sehingga isian yang belum disimpan tidak hilang saat berpindah tab.
 */
export function Tabs({
  items,
  value,
  onChange,
  label,
  variant = 'garis',
  keepMounted = false,
  disabled,
  className,
  panelClassName,
}: {
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  variant?: TabsVariant;
  keepMounted?: boolean;
  disabled?: boolean;
  className?: string;
  panelClassName?: string;
}) {
  const idBase = useId();
  const active = items.find((t) => t.id === value) ?? items[0];
  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <TabList
        items={items}
        value={active?.id ?? ''}
        onChange={onChange}
        label={label}
        idBase={idBase}
        allPanelsMounted={keepMounted}
        variant={variant}
        disabled={disabled}
      />
      {keepMounted
        ? items.map((t) => (
            <TabPanel
              key={t.id}
              idBase={idBase}
              value={t.id}
              hidden={t.id !== active?.id}
              className={panelClassName}
            >
              {t.content}
            </TabPanel>
          ))
        : active && (
            // Kunci per tab: isi tab lain tidak mewarisi state komponen sejenis dari tab sebelumnya.
            <TabPanel key={active.id} idBase={idBase} value={active.id} className={panelClassName}>
              {active.content}
            </TabPanel>
          )}
    </div>
  );
}
