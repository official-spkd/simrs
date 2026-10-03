import { AppShell } from '@simrs/ui';
import type { ReactNode } from 'react';
import { LogoutButton } from '@/components/logout-button';
import { StaffSidebar } from '@/components/staff-sidebar';
import { navGroups } from '@/lib/nav';
import { requireSession } from '@/lib/server/session';
import { isSuperadmin } from '@/lib/session-view';

/**
 * Kerangka halaman staf. Sesi diperiksa di sini untuk identitas dan menu, DAN di setiap halaman
 * (`requireSession` di-cache per render), karena layout tidak dirender ulang saat navigasi.
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  return (
    <AppShell
      tenantName={s.tenant.name}
      sidebar={
        <StaffSidebar
          tenantName={s.tenant.name}
          unitName={s.unit?.name ?? 'Semua unit'}
          user={{ name: s.user.displayName, role: s.role?.name ?? '—', initials: s.user.initials }}
          groups={navGroups({ kind: s.tenant.kind, superadmin: isSuperadmin(s), permissions: s.permissions })}
          userActions={<LogoutButton />}
        />
      }
    >
      {children}
    </AppShell>
  );
}
