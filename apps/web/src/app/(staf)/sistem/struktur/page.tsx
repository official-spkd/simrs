import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScreenHeader } from '@/components/platform/parts';
import { StrukturBoard } from '@/components/platform/struktur-board';
import { getFacilityStructure } from '@/lib/server/data/platform';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Struktur RS' };

/**
 * P01 · Struktur RS: faskes → unit → ruang → kamar → bed (tanpa mockup). Mode presentasi: data fiktif (ADR-0023);
 * perubahan tersimpan di toko demo bersama (domain `struktur`, ADR-0085).
 */
export default async function StrukturPage() {
  const { session, screen, allowed } = await requireDemoScreen('struktur');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getFacilityStructure();
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        trail={`Sistem / Struktur RS · P01 · ${session.tenant.name}`}
        title="Struktur RS · faskes sampai bed"
      />
      <StrukturBoard state={d.state} rev={d.rev} />
    </div>
  );
}
