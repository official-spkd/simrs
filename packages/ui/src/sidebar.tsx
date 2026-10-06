import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './icons';
import { type DomainKey, domainColor } from './tokens';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  /** Layar belum dibangun: tampil redup dan tidak bisa diklik. */
  available: boolean;
  count?: string | number;
  urgent?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
  /** Rona domain grup (titik grup dan item aktif). Bawaan `fo` (samudra). */
  domain?: DomainKey;
}

export type LinkLike = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
  'aria-current'?: 'page' | undefined;
  title?: string;
}>;

const DefaultLink: LinkLike = ({ children, ...props }) => <a {...props}>{children}</a>;

export interface IntegrationStatusItem {
  label: string;
  state: 'normal' | 'gangguan' | 'tidak-diketahui';
  text: string;
}

export interface SidebarProps {
  groups: NavGroup[];
  activeId?: string;
  tenantName: string;
  unitName: string;
  user: { name: string; role: string; initials: string };
  integrations?: IntegrationStatusItem[];
  integrationHref?: string;
  LinkComponent?: LinkLike;
  /** Aksi akun di bawah identitas pengguna (mis. tombol Keluar). */
  userActions?: ReactNode;
  /**
   * Menu yang bisa dibuka lebih banyak dari ini (mis. Superadmin demo): grup domain lain dilipat menjadi satu baris "N layar",
   * grup layar aktif tetap terbuka. Grup ≤ 2 menu tidak pernah dilipat.
   */
  collapseAfter?: number;
}

const dot = {
  normal: 'bg-zamrud-500',
  gangguan: 'bg-koral-600 animate-crit',
  'tidak-diketahui': 'bg-batu-500',
} as const;

/** Navigasi samping kaca 236 px (Pelangi Klinis, ADR-0091): titik rona per grup, item aktif bergradien domain. */
export function Sidebar({
  groups,
  activeId,
  tenantName,
  unitName,
  user,
  integrations = [],
  integrationHref = '#',
  LinkComponent = DefaultLink,
  userActions,
  collapseAfter = 24,
}: SidebarProps) {
  // Hanya menu yang bisa dibuka yang dihitung: menu redup (layar belum dibangun) tidak membuat sidebar terlipat.
  const total = groups.reduce((n, g) => n + g.items.filter((i) => i.available).length, 0);
  return (
    <nav
      aria-label="Navigasi utama"
      className="glass-soft flex min-h-full w-sidebar flex-col gap-2 border-r border-white/70 px-2.5 py-[18px] text-[13.5px] leading-snug"
    >
      <div className="flex items-center gap-2.5 px-2 pb-1.5">
        <div className="flex size-8 items-center justify-center rounded-[10px] bg-fajar text-white shadow-[0_6px_16px_rgba(44,85,196,0.35)]">
          <Icon name="plus" size={18} strokeWidth={2.2} />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-bold">{tenantName}</span>
          <span className="text-caption text-ink-500">{unitName}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {groups.map((g) => {
          const domain = g.domain ?? 'fo';
          const vars = {
            '--g-600': domainColor(domain, '600'),
            '--g-800': domainColor(domain, '800'),
          } as CSSProperties;
          const hasActive = g.items.some((n) => n.id === activeId);
          const collapsible = total > collapseAfter && g.items.length > 2;
          const head = (
            <>
              <span aria-hidden="true" className="size-[9px] shrink-0 rounded-[3px] bg-[var(--g-600)]" />
              <span>{g.title}</span>
            </>
          );
          const items = (
            <div className="flex flex-col gap-0.5">
              {g.items.map((n) => (
                <SidebarLink key={n.id} item={n} on={n.id === activeId} LinkComponent={LinkComponent} />
              ))}
            </div>
          );
          if (collapsible) {
            return (
              // `key` ikut status aktif: berpindah ke layar grup ini membuka grupnya, grup lain kembali terlipat.
              <details key={`${g.title}:${hasActive}`} open={hasActive} style={vars} className="group/grp">
                <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-[10px] px-2.5 py-[7px] text-[12px] font-semibold tracking-[0.05em] text-ink-700 hover:bg-white/75 max-md:min-h-touch pointer-coarse:min-h-touch [&::-webkit-details-marker]:hidden">
                  {head}
                  <span className="ml-auto shrink-0 text-[11px] font-medium tracking-normal whitespace-nowrap text-ink-500">
                    {g.items.length} layar
                  </span>
                  <Icon
                    name="chevronDown"
                    size={14}
                    className="text-ink-500 transition-transform group-open/grp:rotate-180"
                  />
                </summary>
                {items}
              </details>
            );
          }
          return (
            <div key={g.title} style={vars} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2 px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[0.06em] text-ink-700">
                {head}
              </span>
              {items}
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col gap-2.5 pt-2">
        {integrations.length > 0 && (
          <LinkComponent
            href={integrationHref}
            className="flex min-h-touch flex-col gap-[5px] rounded-[12px] border border-white/90 bg-white/65 px-3 py-2.5 no-underline"
          >
            <span className="text-caption font-semibold text-ink-900">Status integrasi</span>
            {integrations.map((i) => (
              <span key={i.label} className="flex items-center gap-1.5 text-caption text-ink-700">
                <span className={cx('size-[7px] rounded-full', dot[i.state])} aria-hidden="true" />
                {i.label} · {i.text}
              </span>
            ))}
          </LinkComponent>
        )}
        <div className="flex items-center gap-2.5 rounded-[12px] bg-white/65 p-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-samudra-100),var(--color-samudra-50))] text-caption font-bold text-samudra-700">
            {user.initials}
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="text-small font-semibold">{user.name}</span>
            <span className="text-caption text-ink-500">{user.role}</span>
          </div>
        </div>
        {userActions && <div className="px-1.5">{userActions}</div>}
      </div>
    </nav>
  );
}

function SidebarLink({ item: n, on, LinkComponent }: { item: NavItem; on: boolean; LinkComponent: LinkLike }) {
  const body = (
    <>
      <Icon name={n.icon} />
      <span className="flex-1">{n.label}</span>
      {n.count !== undefined && (
        <span
          className={cx(
            'rounded-full px-[7px] text-[11px] font-semibold',
            n.urgent
              ? 'bg-koral-100 text-koral-800'
              : on
                ? 'bg-white text-[var(--g-800)]'
                : 'bg-white/80 text-ink-700',
          )}
        >
          {n.count}
        </span>
      )}
    </>
  );
  // Padat di desktop; 44 px di layar sentuh dan menu sempit (target sentuh).
  const cls = cx(
    'flex items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] no-underline max-md:min-h-touch pointer-coarse:min-h-touch',
    on
      ? 'bg-[linear-gradient(135deg,var(--g-800),var(--g-600))] font-semibold text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]'
      : 'text-ink-900',
  );
  return n.available ? (
    <LinkComponent
      href={n.href}
      className={cx(
        cls,
        'transition-[background-color,transform] duration-150',
        on ? 'hover:text-white' : 'hover:translate-x-0.5 hover:bg-white/75 hover:text-ink-900',
      )}
      aria-current={on ? 'page' : undefined}
    >
      {body}
    </LinkComponent>
  ) : (
    <span
      className={cx(cls, 'cursor-not-allowed opacity-55')}
      title={`${n.label} · layar belum tersedia`}
      aria-disabled="true"
    >
      {body}
    </span>
  );
}
