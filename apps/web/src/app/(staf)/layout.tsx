import { AppShell } from '@simrs/ui';
import type { ReactNode } from 'react';
import { LogoutButton } from '@/components/logout-button';
import { NotificationBell } from '@/components/notification-bell';
import { SwitchPositionLink } from '@/components/switch-position-link';
import { StaffSidebar } from '@/components/staff-sidebar';
import { navGroups } from '@/lib/nav';
import { api } from '@/lib/server/api';
import { unreadNotifications } from '@/lib/server/notifications';
import { assignmentsSchema } from '@/lib/server/schemas';
import { requireSession } from '@/lib/server/session';
import { isSuperadmin } from '@/lib/session-view';

/**
 * Kerangka halaman staf. Sesi diperiksa di sini untuk identitas dan menu, DAN di setiap halaman
 * (`requireSession` di-cache per render), karena layout tidak dirender ulang saat navigasi.
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  const [unread, positions] = await Promise.all([
    unreadNotifications(),
    api('/api/v1/auth/assignments', { schema: assignmentsSchema }).then(
      (a) => a.length,
      () => 0,
    ),
  ]);
  return (
    <AppShell
      tenantName={s.tenant.name}
      header={<NotificationBell unread={unread} />}
      sidebar={
        <StaffSidebar
          tenantName={s.tenant.name}
          unitName={s.unit?.name ?? 'Semua unit'}
          user={{ name: s.user.displayName, role: s.role?.name ?? '—', initials: s.user.initials }}
          groups={navGroups({ kind: s.tenant.kind, superadmin: isSuperadmin(s), permissions: s.permissions })}
          userActions={
            positions > 1 ? (
              <div className="flex flex-col gap-2">
                <SwitchPositionLink />
                <LogoutButton />
              </div>
            ) : (
              <LogoutButton />
            )
          }
        />
      }
    >
      {children}
    </AppShell>
  );
}
