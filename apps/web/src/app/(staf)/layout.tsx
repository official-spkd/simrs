import { AppShell } from '@simrs/ui';
import type { ReactNode } from 'react';
import { DemoBadge } from '@/components/demo-badge';
import { DemoGuide } from '@/components/demo-guide';
import { DemoSync } from '@/components/demo-sync';
import { LogoutButton } from '@/components/logout-button';
import { NotificationBell } from '@/components/notification-bell';
import { PinLink } from '@/components/pin-link';
import { SwitchPositionLink } from '@/components/switch-position-link';
import { StaffSidebar } from '@/components/staff-sidebar';
import { runScenario } from '@/lib/demo/engine/run';
import { guideView } from '@/lib/demo/guide-view';
import { SCENARIOS } from '@/lib/demo/skenario';
import { navGroups } from '@/lib/nav';
import { api } from '@/lib/server/api';
import { loadDemoRuns } from '@/lib/server/demo/scenario';
import { unreadNotifications } from '@/lib/server/notifications';
import { assignmentsSchema } from '@/lib/server/schemas';
import { requireSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { canRegisterPin, isSuperadmin } from '@/lib/session-view';

/**
 * Kerangka halaman staf. Sesi diperiksa di sini untuk identitas dan menu, DAN di setiap halaman
 * (`requireSession` di-cache per render), karena layout tidak dirender ulang saat navigasi.
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  const { dataSource } = webEnv();
  const demo = dataSource === 'demo' ? await loadDemoRuns(s) : null;
  const [unread, positions] = await Promise.all([
    unreadNotifications(),
    api('/api/v1/auth/assignments', { schema: assignmentsSchema }).then(
      (a) => a.length,
      () => 0,
    ),
  ]);
  // PIN masuk cepat: posisi yang boleh mendaftarkannya, atau sesi yang dibuka dengan PIN (untuk menghapusnya).
  const pin = canRegisterPin(s) || Boolean(s.quickLogin);
  return (
    <AppShell
      tenantName={s.tenant.name}
      // Mode presentasi: header lengket berisi pemicu panduan (tidak melayang di atas isi halaman).
      stickyHeader={Boolean(demo)}
      header={
        <>
          {dataSource === 'demo' && <DemoBadge />}
          <NotificationBell unread={unread} />
          {demo && (
            <DemoGuide
              rev={demo.rev}
              guide={guideView(
                runScenario(SCENARIOS[demo.active], demo.runs[demo.active]),
                s.role?.code ?? null,
              )}
            />
          )}
        </>
      }
      sidebar={
        <StaffSidebar
          tenantName={s.tenant.name}
          unitName={s.unit?.name ?? 'Semua unit'}
          user={{ name: s.user.displayName, role: s.role?.name ?? '—', initials: s.user.initials }}
          groups={navGroups({
            kind: s.tenant.kind,
            superadmin: isSuperadmin(s),
            permissions: s.permissions,
            dataSource,
            role: s.role?.code ?? null,
          })}
          userActions={
            positions > 1 || pin ? (
              <div className="flex flex-col gap-2">
                {positions > 1 && <SwitchPositionLink />}
                {pin && <PinLink />}
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
      {demo && <DemoSync />}
    </AppShell>
  );
}
