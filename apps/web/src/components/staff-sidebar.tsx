'use client';

import { Sidebar } from '@simrs/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeNavId, NAV_GROUPS } from '@/lib/nav';

export function StaffSidebar() {
  const pathname = usePathname();
  return (
    <Sidebar
      groups={NAV_GROUPS}
      activeId={activeNavId(pathname)}
      tenantName="[NAMA RS]"
      unitName="SIM RS · lokal"
      // Fase 0 belum punya login; identitas pengguna datang dari P02 (fase 1).
      user={{ name: 'Pengembang lokal', role: 'Belum masuk', initials: 'PL' }}
      integrations={[
        { label: 'SATUSEHAT', state: 'tidak-diketahui', text: 'mock' },
        { label: 'BPJS', state: 'tidak-diketahui', text: 'mock' },
      ]}
      integrationHref="/"
      LinkComponent={Link}
    />
  );
}
