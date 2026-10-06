'use client';

import { AppShell, type CommandItem, CommandPalette } from '@simrs/ui';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useMemo } from 'react';
import { navContext, type WebNavGroup } from '@/lib/nav';

/**
 * Kerangka staf Pelangi Klinis (ADR-0091). Menu, header, dan isi dihitung di server; komponen klien ini hanya
 * membaca URL untuk memilih rona domain jendela (`data-domain`) dan memasang palet perintah ⌘K berisi layar yang
 * boleh dibuka sesi ini (sama dengan menu).
 */
export function StaffShell({
  tenantName,
  stickyHeader,
  groups,
  header,
  sidebar,
  children,
}: {
  tenantName: string;
  stickyHeader: boolean;
  groups: WebNavGroup[];
  header: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
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
  return (
    <AppShell
      tenantName={tenantName}
      stickyHeader={stickyHeader}
      domain={domain}
      domainLabel={label || undefined}
      header={
        <>
          <CommandPalette items={items} onSelect={(href) => router.push(href)} />
          {header}
        </>
      }
      sidebar={sidebar}
    >
      {children}
    </AppShell>
  );
}
