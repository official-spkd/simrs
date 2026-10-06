'use client';

import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { Icon } from './icons';
import { type DomainKey, domainColor } from './tokens';

export interface CommandItem {
  id: string;
  label: string;
  /** Nama grup (mis. "KLINIS"), tampil sebagai judul kelompok hasil. */
  group: string;
  href: string;
  domain?: DomainKey;
}

/** Saring tanpa beda huruf besar/kecil: semua kata kueri harus ada di label atau grup; awalan label di depan. */
export function filterCommands(items: readonly CommandItem[], query: string): CommandItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  const q = words.join(' ');
  return items
    .filter((i) => {
      const hay = `${i.label} ${i.group}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort(
      (a, b) => Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)),
    );
}

/**
 * Palet perintah ⌘K / Ctrl K (Pelangi Klinis): cari dan buka layar dari mana saja. Pola combobox + listbox
 * (`aria-activedescendant`): fokus tetap di kotak cari, panah atas/bawah memilih, Enter membuka, Esc menutup dan
 * mengembalikan fokus ke pemicu. Kartu kaca muncul dari atas (tempat pemicunya) dan hilang ke arah yang sama.
 */
export function CommandPalette({
  items,
  onSelect,
  placeholder = 'Cari layar… (mis. "farmasi", "klaim")',
}: {
  items: readonly CommandItem[];
  onSelect: (href: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [mac, setMac] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const results = useMemo(() => filterCommands(items, query), [items, query]);
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, listId]);

  const choose = (item: CommandItem | undefined) => {
    if (!item) return;
    close();
    onSelect(item.href);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = results.length;
    if (e.key === 'ArrowDown' && n > 0) {
      e.preventDefault();
      setActive((a) => (a + 1) % n);
    } else if (e.key === 'ArrowUp' && n > 0) {
      e.preventDefault();
      setActive((a) => (a - 1 + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // Dialog modal: fokus tetap di kotak cari.
      e.preventDefault();
    }
  };

  const shortcut = mac ? '⌘K' : 'Ctrl K';
  let lastGroup = '';
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 min-w-0 cursor-pointer items-center gap-2 rounded-[11px] border border-white/90 bg-white/75 px-3 font-[inherit] text-ink-700 shadow-[0_2px_8px_rgba(23,32,46,0.06)] hover:shadow-[0_6px_18px_color-mix(in_srgb,var(--color-brand-600)_18%,transparent)] md:min-w-60"
      >
        <Icon name="search" size={16} />
        <span className="flex-1 text-left text-small">Cari layar</span>
        <kbd className="rounded-md border border-[rgba(23,32,46,0.15)] bg-white px-1.5 font-[inherit] text-[11px] text-ink-700">
          {shortcut}
        </kbd>
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex animate-fade items-start justify-center bg-[rgba(15,23,42,0.28)] px-4 pt-[12vh] backdrop-blur-[3px]"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Palet perintah"
              className="glass w-full max-w-[620px] origin-top animate-pal-in overflow-hidden rounded-[18px] border border-white/95 shadow-float"
            >
              <label className="flex items-center gap-3 border-b border-[rgba(23,32,46,0.07)] px-4 py-3.5">
                <Icon name="search" size={20} className="text-ink-500" />
                <span className="sr-only">Cari layar</span>
                <input
                  autoFocus
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder={placeholder}
                  className="min-w-0 flex-1 border-0 bg-transparent font-[inherit] text-[17px] text-ink-900 outline-none placeholder:text-ink-400"
                />
              </label>
              <ul
                id={listId}
                role="listbox"
                aria-label="Hasil pencarian layar"
                className="m-0 flex max-h-[min(60vh,480px)] list-none flex-col gap-0.5 overflow-y-auto p-2"
              >
                {results.length === 0 && (
                  <li role="presentation" className="px-3 py-6 text-center text-ink-500">
                    Tidak ada layar yang cocok dengan &ldquo;{query}&rdquo;.
                  </li>
                )}
                {results.map((item, i) => {
                  const head = item.group !== lastGroup;
                  lastGroup = item.group;
                  const on = i === active;
                  const d = item.domain ?? 'fo';
                  const vars = {
                    '--o-600': domainColor(d, '600'),
                    '--o-800': domainColor(d, '800'),
                  } as CSSProperties;
                  return [
                    head && (
                      <li
                        key={`g-${item.group}-${i}`}
                        role="presentation"
                        className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[0.05em] text-ink-500"
                      >
                        {item.group}
                      </li>
                    ),
                    <li
                      key={item.id}
                      id={optionId(i)}
                      role="option"
                      aria-selected={on}
                      style={vars}
                      onMouseMove={() => setActive(i)}
                      onClick={() => choose(item)}
                      className={cx(
                        'flex min-h-touch cursor-pointer items-center gap-3 rounded-[11px] px-3 py-2',
                        on
                          ? 'bg-[linear-gradient(135deg,var(--o-800),var(--o-600))] font-semibold text-white'
                          : 'text-ink-900',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cx('size-2 shrink-0 rounded-full', on ? 'bg-white' : 'bg-[var(--o-600)]')}
                      />
                      <span className="flex-1">{item.label}</span>
                      {on && <span className="text-caption font-medium opacity-90">Enter untuk membuka</span>}
                    </li>,
                  ];
                })}
              </ul>
              <div className="flex flex-wrap gap-4 border-t border-[rgba(23,32,46,0.07)] px-4 py-2.5 text-caption text-ink-500">
                <span>↑ ↓ pilih</span>
                <span>Enter buka</span>
                <span>Esc tutup</span>
                <span className="ml-auto">{results.length} layar</span>
              </div>
            </div>
          </div>,
          // Portal ke body: header kaca (backdrop-filter) menjadi containing block bagi `fixed`, scrim harus di luar.
          document.body,
        )}
    </>
  );
}
