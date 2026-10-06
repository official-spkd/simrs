'use client';

import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './icons';
import type { IntegrationStatusItem, LinkLike, NavGroup, NavItem } from './sidebar';
import { domainColor } from './tokens';

const DefaultLink: LinkLike = ({ children, ...props }) => <a {...props}>{children}</a>;

export interface DockProps {
  groups: NavGroup[];
  activeId?: string;
  tenantName: string;
  unitName: string;
  user: { name: string; role: string; initials: string };
  integrations?: IntegrationStatusItem[];
  LinkComponent?: LinkLike;
  /** Aksi akun di stack Akun (ganti posisi, PIN, keluar). */
  userActions?: ReactNode;
  /** Tombol Cari di dock membuka palet perintah. */
  onSearch?: () => void;
}

/** "FRONT OFFICE" → "Front office". */
export function groupLabel(title: string): string {
  return title.charAt(0) + title.slice(1).toLowerCase();
}

const dot = {
  normal: 'bg-zamrud-500',
  gangguan: 'bg-koral-600 animate-crit',
  'tidak-diketahui': 'bg-batu-500',
} as const;

const TILE =
  'dock-tile flex size-12 items-center justify-center rounded-[14px] max-md:size-10 max-md:rounded-[12px]';
/** Ubin domain: gradien satu rona 800 → 600, ikon putih. */
const DOMAIN_TILE =
  'bg-[linear-gradient(135deg,var(--g-800),var(--g-600))] text-white shadow-[0_8px_18px_rgba(23,32,46,0.22),inset_0_1px_0_rgba(255,255,255,0.35)]';
const TIP =
  'dock-tip pointer-events-none text-[10px] font-medium whitespace-nowrap text-ink-700 md:absolute md:bottom-[calc(100%+18px)] md:left-1/2 md:-translate-x-1/2 md:rounded-[9px] md:border md:border-white/95 md:bg-white/92 md:px-2.5 md:py-1 md:text-caption md:font-semibold md:text-ink-900 md:opacity-0 md:shadow-[0_8px_20px_rgba(23,32,46,0.16)] md:transition-opacity';
const STACK =
  'z-10 flex max-h-[min(60vh,440px)] animate-stack-in flex-col gap-0.5 overflow-y-auto rounded-[18px] border border-white/95 bg-white/97 p-2.5 shadow-float max-md:absolute max-md:inset-x-0 max-md:bottom-[calc(100%+8px)] md:absolute md:bottom-[calc(100%+16px)] md:left-1/2 md:w-72 md:origin-bottom md:-translate-x-1/2';

/**
 * Dock navigasi ala macOS (Pelangi Klinis, ADR-0092): satu ikon per grup menu berwarna rona domainnya. Klik ikon
 * membuka stack daftar layar grup itu di atas ikon; Esc, klik di luar, atau berpindah layar menutupnya. Grup berisi
 * satu layar langsung menjadi tautan. Titik di bawah ikon menandai grup layar yang sedang dibuka. Di bawah 768 px
 * dock menjadi bilah bawah selebar layar berlabel dan stack menjadi lembar di atasnya. Semua tautan tetap di DOM
 * (stack tertutup memakai `hidden`), sehingga isi menu sama dengan sidebar.
 */
export function Dock({
  groups,
  activeId,
  tenantName,
  unitName,
  user,
  integrations = [],
  LinkComponent = DefaultLink,
  userActions,
  onSearch,
}: DockProps) {
  const [open, setOpen] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());
  const baseId = useId();

  // Pindah layar menutup stack.
  useEffect(() => setOpen(null), [activeId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      const key = open;
      setOpen(null);
      buttons.current.get(key)?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (nav.current && !nav.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const toggle = (key: string) => setOpen((o) => (o === key ? null : key));
  const register = (key: string) => (el: HTMLButtonElement | null) => {
    buttons.current.set(key, el);
  };

  return (
    <nav
      ref={nav}
      aria-label="Navigasi utama"
      className="glass fixed inset-x-2 bottom-2 z-40 animate-dock-in rounded-[20px] border border-white/85 px-2 pt-1.5 pb-1 shadow-[0_22px_50px_rgba(23,32,46,0.22),inset_0_1px_0_rgba(255,255,255,0.95)] md:inset-x-auto md:bottom-3.5 md:left-1/2 md:-translate-x-1/2 md:rounded-[24px] md:px-2.5 md:pt-2 md:pb-1.5"
    >
      <ul className="m-0 flex list-none items-end gap-1 overflow-x-auto p-0 md:gap-1.5 md:overflow-visible">
        {groups.map((g) => {
          const key = g.title;
          const domain = g.domain ?? 'fo';
          const vars = {
            '--g-600': domainColor(domain, '600'),
            '--g-800': domainColor(domain, '800'),
          } as CSSProperties;
          const label = groupLabel(g.title);
          const running = g.items.some((i) => i.id === activeId);
          const urgent = g.items.filter((i) => i.urgent && i.available).length;
          const icon: IconName = g.icon ?? 'layout';
          const tile = (
            <span className={cx(TILE, DOMAIN_TILE)}>
              <Icon name={icon} size={22} strokeWidth={1.9} />
            </span>
          );
          const badge = urgent > 0 && (
            <span className="absolute -top-1 right-0 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-koral-600 px-1 text-[10.5px] font-bold text-white shadow-[0_2px_6px_rgba(194,50,33,0.4)] md:-right-1.5">
              {urgent}
            </span>
          );
          const only = g.items.length === 1 ? g.items[0] : undefined;
          if (only?.available) {
            return (
              <li key={key} style={vars} className="dock-item relative flex shrink-0 flex-col items-center">
                <LinkComponent
                  href={only.href}
                  className="dock-btn flex min-w-12 flex-col items-center gap-1 no-underline"
                  aria-current={only.id === activeId ? 'page' : undefined}
                  title={only.label}
                >
                  {tile}
                  <span className={TIP}>{only.label}</span>
                </LinkComponent>
                <RunDot on={running} />
              </li>
            );
          }
          const panelId = `${baseId}-${g.title.replace(/\W+/g, '-')}`;
          const isOpen = open === key;
          return (
            <li key={key} style={vars} className="dock-item flex shrink-0 flex-col items-center md:relative">
              <div id={panelId} hidden={!isOpen} className={STACK}>
                <div className="mb-1 flex items-center gap-2.5 border-b border-[rgba(23,32,46,0.07)] px-2 pt-1 pb-2.5">
                  <span className="flex size-8 items-center justify-center rounded-[10px] bg-[linear-gradient(135deg,var(--g-800),var(--g-600))] text-white">
                    <Icon name={icon} size={17} strokeWidth={1.9} />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[14px] font-bold">{label}</span>
                    <span className="text-[11.5px] text-ink-500">{g.items.length} layar</span>
                  </span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {g.items.map((n) => (
                    <li key={n.id}>
                      <StackLink item={n} on={n.id === activeId} LinkComponent={LinkComponent} />
                    </li>
                  ))}
                </ul>
              </div>
              <button
                ref={register(key)}
                type="button"
                className="dock-btn relative flex min-w-12 cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-0 font-[inherit]"
                aria-expanded={isOpen}
                aria-controls={panelId}
                aria-label={`${label} · ${g.items.length} layar`}
                onClick={() => toggle(key)}
              >
                {tile}
                {badge}
                <span className={cx(TIP, isOpen && 'md:!opacity-0')} aria-hidden="true">
                  {label}
                </span>
              </button>
              <RunDot on={running} />
            </li>
          );
        })}

        <li aria-hidden="true" className="mx-1 mb-3.5 hidden w-px self-stretch bg-[rgba(23,32,46,0.16)] md:block" />

        {onSearch && (
          <li className="dock-item relative flex shrink-0 flex-col items-center">
            <button
              type="button"
              className="dock-btn flex min-w-12 cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-0 font-[inherit]"
              aria-label="Cari layar"
              aria-keyshortcuts="Meta+K Control+K"
              onClick={() => {
                setOpen(null);
                onSearch();
              }}
            >
              <span className={cx(TILE, 'bg-white text-ink-700 shadow-[0_6px_14px_rgba(23,32,46,0.14)]')}>
                <Icon name="search" size={22} strokeWidth={1.9} />
              </span>
              <span className={TIP} aria-hidden="true">
                Cari
              </span>
            </button>
            <RunDot on={false} />
          </li>
        )}

        <li className="dock-item flex shrink-0 flex-col items-center md:relative">
          <div id={`${baseId}-akun`} hidden={open !== 'akun'} className={STACK}>
            <div className="flex items-center gap-2.5 px-2 pt-1 pb-2">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-samudra-100),var(--color-samudra-50))] font-bold text-samudra-700">
                {user.initials}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{user.name}</span>
                <span className="text-caption text-ink-500">{user.role}</span>
              </span>
            </div>
            <span className="px-2 text-caption text-ink-700">
              {tenantName} · {unitName}
            </span>
            {integrations.length > 0 && (
              <div className="mx-1 my-1.5 flex flex-col gap-1 rounded-[12px] bg-white/70 px-3 py-2">
                <span className="text-caption font-semibold text-ink-900">Status integrasi</span>
                {integrations.map((i) => (
                  <span key={i.label} className="flex items-center gap-1.5 text-caption text-ink-700">
                    <span className={cx('size-[7px] rounded-full', dot[i.state])} aria-hidden="true" />
                    {i.label} · {i.text}
                  </span>
                ))}
              </div>
            )}
            {userActions && <div className="px-1 pt-1">{userActions}</div>}
          </div>
          <button
            ref={register('akun')}
            type="button"
            className="dock-btn flex min-w-12 cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-0 font-[inherit]"
            aria-expanded={open === 'akun'}
            aria-controls={`${baseId}-akun`}
            aria-label={`Akun · ${user.name}`}
            onClick={() => toggle('akun')}
          >
            <span
              className={cx(
                TILE,
                'bg-[linear-gradient(135deg,var(--color-samudra-100),var(--color-samudra-50))] text-[14px] font-bold text-samudra-700',
              )}
            >
              {user.initials}
            </span>
            <span className={cx(TIP, open === 'akun' && 'md:!opacity-0')} aria-hidden="true">
              Akun
            </span>
          </button>
          <RunDot on={false} />
        </li>
      </ul>
    </nav>
  );
}

function RunDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx('mt-1 hidden size-[5px] rounded-full md:block', on ? 'bg-ink-900' : 'bg-transparent')}
    />
  );
}

function StackLink({ item: n, on, LinkComponent }: { item: NavItem; on: boolean; LinkComponent: LinkLike }) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className={cx('size-[7px] shrink-0 rounded-full', on ? 'bg-white' : 'bg-[var(--g-600)]')}
      />
      <span className="flex-1">{n.label}</span>
      {n.count !== undefined && (
        <span
          className={cx(
            'rounded-full px-[7px] text-[11px] font-semibold',
            n.urgent ? 'bg-koral-100 text-koral-800' : on ? 'bg-white text-[var(--g-800)]' : 'bg-batu-100 text-ink-700',
          )}
        >
          {n.count}
        </span>
      )}
    </>
  );
  const cls = cx(
    'flex min-h-touch items-center gap-2.5 rounded-[11px] px-2.5 text-[13.5px] no-underline md:min-h-10',
    on
      ? 'bg-[linear-gradient(135deg,var(--g-800),var(--g-600))] font-semibold text-white hover:text-white'
      : 'text-ink-900 hover:bg-white hover:text-ink-900',
  );
  return n.available ? (
    <LinkComponent href={n.href} className={cls} aria-current={on ? 'page' : undefined}>
      {body}
    </LinkComponent>
  ) : (
    <span className={cx(cls, 'cursor-not-allowed opacity-55')} title={`${n.label} · layar belum tersedia`} aria-disabled="true">
      {body}
    </span>
  );
}
