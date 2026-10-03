import { AppShell } from '@simrs/ui';
import type { ReactNode } from 'react';
import { StaffSidebar } from '@/components/staff-sidebar';

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell tenantName="[NAMA RS]" sidebar={<StaffSidebar />}>
      {children}
    </AppShell>
  );
}
