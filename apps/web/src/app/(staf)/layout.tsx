import { AppShell } from '@simrs/ui';
import type { ReactNode } from 'react';
import { StaffSidebar } from '@/components/staff-sidebar';
import { superadminAccess } from '@/lib/access';

// Menu bergantung pada keputusan akses runtime.
export const dynamic = 'force-dynamic';

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell tenantName="[NAMA RS]" sidebar={<StaffSidebar superadmin={superadminAccess().allowed} />}>
      {children}
    </AppShell>
  );
}
