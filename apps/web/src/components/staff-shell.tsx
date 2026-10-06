'use client';

import { AppShell, type CommandItem, CommandPalette, Dock, Icon, type NavLayout, cx } from '@simrs/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState } from 'react';
import { activeNavId, navContext, type WebNavGroup } from '@/lib/nav';
import { writeNavLayoutCookie } from '@/lib/nav-layout';

/** Status integrasi di sidebar dan stack Akun dock (belum terhubung pemantauan sungguhan). */
export const INTEGRATION_STATUS = [
  { label: 'SATUSEHAT', state: 'tidak-diketahui', text: 'mock' },
  { label: 'BPJS', state: 'tidak-diketahui', text: 'mock' },
] as const;

/**
 * Kerangka staf Pelangi Klinis (ADR-0091, ADR-0092). Menu, header, dan isi dihitung di server; komponen klien ini
 * membaca URL untuk rona domain (`data-domain`), memasang palet perintah ⌘K, dan menampilkan navigasi sebagai dock
 * (bawaan) atau sidebar sesuai pilihan pengguna (cookie, dibaca server untuk render awal).
 */
export function StaffShell({
  tenantName,
  unitName,
  user,
  stickyHeader,
  groups,
  initialLayout,
  header,
  sidebar,
  userActions,
  children,
}: {
  tenantName: string;
  unitName: string;
  user: { name: string; role: string; initials: string };
  stickyHeader: boolean;
  groups: WebNavGroup[];
  initialLayout: NavLayout;
  header: ReactNode;
  sidebar: ReactNode;
  userActions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [layout, setLayout] = useState<NavLayout>(initialLayout);
  const [palette, setPalette] = useState(false);
  const { domain, label } = navContext(pathname);
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: CommandItem[] = [];
    for (const g of groups) {
      for (const i of g.items) {
        if (!i.available || seen.has(i.href)) continue;
        seen.add(i.href);
        out.push({ id: `${g.title}:${i.id}`, label: i.label, group: g.title, href: i.href, domain: g.domain });
      }
    }
    return out;
  }, [groups]);
  const choose = (next: NavLayout) => {
    setLayout(next);
    writeNavLayoutCookie(next);
  };
  return (
    <AppShell
      tenantName={tenantName}
      stickyHeader={stickyHeader}
      domain={domain}
      domainLabel={label || undefined}
      layout={layout}
      header={
        <>
          <CommandPalette
            items={items}
            onSelect={(href) => router.push(href)}
            open={palette}
            onOpenChange={setPalette}
          />
          <LayoutToggle value={layout} onChange={choose} />
          {header}
        </>
      }
      sidebar={sidebar}
      dock={
        <Dock
          groups={groups}
          activeId={activeNavId(pathname)}
          tenantName={tenantName}
          unitName={unitName}
          user={user}
          integrations={[...INTEGRATION_STATUS]}
          LinkComponent={Link}
          userActions={userActions}
          onSearch={() => setPalette(true)}
        />
      }
    >
      {children}
    </AppShell>
  );
}

const OPTIONS: ReadonlyArray<{ id: NavLayout; label: string; icon: 'layout' | 'menu' }> = [
  { id: 'dock', label: 'Dock', icon: 'layout' },
  { id: 'sidebar', label: 'Sidebar', icon: 'menu' },
];

/** Pilihan tampilan navigasi (tombol bertekanan, bukan warna saja). Disembunyikan di ponsel: dock dipakai di sana. */
function LayoutToggle({ value, onChange }: { value: NavLayout; onChange: (v: NavLayout) => void }) {
  return (
    <div
      role="group"
      aria-label="Tampilan navigasi"
      className="hidden rounded-[12px] bg-[rgba(23,32,46,0.06)] p-1 md:flex"
    >
      {OPTIONS.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={cx(
              "relative inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[9px] border-0 px-3 font-[inherit] text-small before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
              on ? 'bg-white font-semibold text-ink-900 shadow-tab' : 'bg-transparent text-ink-700',
            )}
          >
            <Icon name={o.icon} size={14} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
