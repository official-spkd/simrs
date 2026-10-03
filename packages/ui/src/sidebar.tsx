import type { ComponentType, ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './icons';

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
}

const dot = { normal: 'bg-[#16A34A]', gangguan: 'bg-danger', 'tidak-diketahui': 'bg-ink-400' } as const;

/** Navigasi samping 240 px sesuai design/mockups/Sidebar.dc.html. */
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
}: SidebarProps) {
  return (
    <nav
      aria-label="Navigasi utama"
      className="flex min-h-full w-sidebar flex-col gap-3.5 border-r border-line bg-white/95 px-3 py-[18px] text-[13.5px] leading-snug"
    >
      <div className="flex items-center gap-2.5 px-1.5">
        <div className="flex size-9 items-center justify-center rounded-control bg-[linear-gradient(135deg,#1D7E77,#0F766E)] text-white shadow-[0_2px_6px_rgba(15,118,110,0.25)]">
          <Icon name="plus" size={18} strokeWidth={2} />
        </div>
        <div className="flex flex-col">
          <span className="text-body font-bold">{tenantName}</span>
          <span className="text-caption text-ink-500">{unitName}</span>
        </div>
      </div>

      <div className="flex flex-col gap-px">
        {groups.map((g) => (
          <div key={g.title} className="flex flex-col gap-px">
            <span className="px-2.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-[0.08em] text-[#5F6E7B]">
              {g.title}
            </span>
            {g.items.map((n) => {
              const on = n.id === activeId;
              const body = (
                <>
                  <Icon name={n.icon} />
                  <span className="flex-1">{n.label}</span>
                  {n.count !== undefined && (
                    <span
                      className={cx(
                        'rounded-full px-[7px] text-[11.5px] font-semibold',
                        n.urgent
                          ? 'bg-[#FEF3F2] text-danger'
                          : on
                            ? 'bg-white text-ink-700'
                            : 'bg-muted text-ink-700',
                      )}
                    >
                      {n.count}
                    </span>
                  )}
                </>
              );
              const cls = cx(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] no-underline',
                on ? 'bg-nav-active font-semibold text-brand-700' : 'text-ink-700',
              );
              return n.available ? (
                <LinkComponent
                  key={n.id}
                  href={n.href}
                  className={cx(cls, 'hover:bg-subtle hover:text-brand-700')}
                  aria-current={on ? 'page' : undefined}
                >
                  {body}
                </LinkComponent>
              ) : (
                <span
                  key={n.id}
                  className={cx(cls, 'cursor-not-allowed opacity-55')}
                  title={`${n.label} · layar belum tersedia`}
                  aria-disabled="true"
                >
                  {body}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-2.5">
        {integrations.length > 0 && (
          <LinkComponent
            href={integrationHref}
            className="flex flex-col gap-[5px] rounded-control border border-brand-100 bg-[linear-gradient(180deg,#F2FAF8,#FFFFFF)] px-3 py-2.5 no-underline"
          >
            <span className="text-caption font-semibold text-brand-700">Status integrasi</span>
            {integrations.map((i) => (
              <span key={i.label} className="flex items-center gap-1.5 text-caption text-ink-700">
                <span className={cx('size-[7px] rounded-full', dot[i.state])} aria-hidden="true" />
                {i.label} · {i.text}
              </span>
            ))}
          </LinkComponent>
        )}
        <div className="flex items-center gap-2.5 border-t border-line px-1.5 pt-3">
          <div className="flex size-[34px] items-center justify-center rounded-full bg-brand-50 text-caption font-bold text-brand-700">
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
