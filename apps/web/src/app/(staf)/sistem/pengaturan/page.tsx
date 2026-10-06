import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { PengaturanBoard } from '@/components/platform/pengaturan-board';
import { ScreenHeader } from '@/components/platform/parts';
import { getTenantSettingsOverview } from '@/lib/server/data/platform';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Pengaturan RS' };

/**
 * P10/P12 · Modul aktif, pengaturan umum, dan template cetak per RS (tanpa mockup). Mode presentasi: data fiktif
 * (ADR-0023); perubahan tersimpan di toko demo bersama (domain `pengaturan`, ADR-0085) atas nama pengguna sesi.
 */
export default async function PengaturanPage() {
  const { session, screen, allowed } = await requireDemoScreen('pengaturan');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getTenantSettingsOverview();
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        trail={`Sistem / Pengaturan RS · P10 · P12 · ${session.tenant.name}`}
        title="Pengaturan RS · modul, aturan, dan template cetak"
      />
      <PengaturanBoard state={d.store.state} rev={d.store.rev} sample={d.sample} />
    </div>
  );
}
