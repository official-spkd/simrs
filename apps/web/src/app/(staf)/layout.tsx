import type { ReactNode } from 'react';
import { ActingRolePicker } from '@/components/acting-role-picker';
import { DemoBadge } from '@/components/demo-badge';
import { DemoGuide } from '@/components/demo-guide';
import { DemoSync } from '@/components/demo-sync';
import { DowntimeBanner } from '@/components/operasional/downtime-banner';
import { LogoutButton } from '@/components/logout-button';
import { NotificationBell } from '@/components/notification-bell';
import { PinLink } from '@/components/pin-link';
import { SwitchPositionLink } from '@/components/switch-position-link';
import { StaffShell } from '@/components/staff-shell';
import { StaffSidebar } from '@/components/staff-sidebar';
import { runScenario } from '@/lib/demo/engine/run';
import { guideView } from '@/lib/demo/guide-view';
import { SCENARIOS } from '@/lib/demo/skenario';
import { navGroups } from '@/lib/nav';
import { api } from '@/lib/server/api';
import { readActiveModules } from '@/lib/server/data/platform';
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
  // Modul aktif dari layar Pengaturan (toko demo): menu modul yang dimatikan disembunyikan. Mode api: null.
  const modules = dataSource === 'demo' ? await readActiveModules() : null;
  const [unread, positions] = await Promise.all([
    unreadNotifications(),
    api('/api/v1/auth/assignments', { schema: assignmentsSchema }).then(
      (a) => a.length,
      () => 0,
    ),
  ]);
  // PIN masuk cepat: posisi yang boleh mendaftarkannya, atau sesi yang dibuka dengan PIN (untuk menghapusnya).
  const pin = canRegisterPin(s) || Boolean(s.quickLogin);
  // Superadmin demo (ADR-0023 keputusan 10): hanya ada bila server memverifikasinya di mode presentasi.
  const allAccess = dataSource === 'demo' ? s.demoAllAccess : undefined;
  const groups = navGroups({
    kind: s.tenant.kind,
    superadmin: isSuperadmin(s),
    permissions: s.permissions,
    dataSource,
    role: s.role?.code ?? null,
    allAccess: Boolean(allAccess),
    modules,
  });
  return (
    <StaffShell
      tenantName={s.tenant.name}
      groups={groups}
      // Mode presentasi: header lengket berisi pemicu panduan (tidak melayang di atas isi halaman).
      stickyHeader={Boolean(demo)}
      header={
        <>
          {dataSource === 'demo' && <DemoBadge />}
          {allAccess && (
            <ActingRolePicker preferred={allAccess.preferredRole} base={allAccess.baseRole?.code ?? null} />
          )}
          <NotificationBell unread={unread} />
          {demo && (
            <DemoGuide
              rev={demo.rev}
              guide={guideView(
                runScenario(SCENARIOS[demo.active], demo.runs[demo.active]),
                s.role?.code ?? null,
                Boolean(allAccess),
              )}
            />
          )}
        </>
      }
      sidebar={
        <StaffSidebar
          tenantName={s.tenant.name}
          unitName={s.unit?.name ?? 'Semua unit'}
          user={{
            name: s.user.displayName,
            role: allAccess ? 'Superadmin demo · semua layar' : (s.role?.name ?? '—'),
            initials: s.user.initials,
          }}
          groups={groups}
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
      {dataSource === 'demo' && <DowntimeBanner />}
      {children}
      {demo && <DemoSync />}
    </StaffShell>
  );
}
