'use client';

import { Sidebar } from '@simrs/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { activeNavId, type WebNavGroup } from '@/lib/nav';
import { INTEGRATION_STATUS } from './staff-shell';

/**
 * Sidebar staf. Semua isinya (identitas, menu sesuai izin) dihitung di server dari sesi lalu diteruskan sebagai
 * prop; komponen klien ini hanya menandai menu aktif dari URL.
 */
export function StaffSidebar({
  tenantName,
  unitName,
  user,
  groups,
  userActions,
}: {
  tenantName: string;
  unitName: string;
  user: { name: string; role: string; initials: string };
  groups: WebNavGroup[];
  userActions?: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <Sidebar
      groups={groups}
      activeId={activeNavId(pathname)}
      tenantName={tenantName}
      unitName={unitName}
      user={user}
      integrations={[...INTEGRATION_STATUS]}
      integrationHref="/"
      LinkComponent={Link}
      userActions={userActions}
    />
  );
}
