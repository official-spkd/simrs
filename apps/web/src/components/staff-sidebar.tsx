'use client';

import { Sidebar } from '@simrs/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeNavId, navGroups } from '@/lib/nav';

/** Keputusan akses dibuat di server (layout) lalu diteruskan sebagai prop; komponen klien tidak membaca env. */
export function StaffSidebar({ superadmin }: { superadmin: boolean }) {
  const pathname = usePathname();
  return (
    <Sidebar
      groups={navGroups({ superadmin })}
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
