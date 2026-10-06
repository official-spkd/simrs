import { formatTanggalWaktu } from '@simrs/shared';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { MicroWorkspace } from '@/components/penunjang/mikro-workspace';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getMicroPa } from '@/lib/server/data/penunjang-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Mikrobiologi & PA' };

/**
 * S02 · Mikrobiologi dan patologi anatomi: kultur bertahap sampai uji kepekaan dan laporan akhir ber-TTE, serta
 * ekspertise PA ber-TTE yang terkunci (addendum). Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function MikrobiologiPage() {
  const { session, screen, allowed } = await requireDemoScreen('mikro');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const data = await getMicroPa();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Penunjang / Laboratorium / Mikrobiologi dan PA · S02 · {session.tenant.name} · data per{' '}
          {formatTanggalWaktu(data.asOf)}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Mikrobiologi & patologi anatomi</h1>
      </header>
      <ScenarioBanner session={session} screen="mikro" />
      <MicroWorkspace data={data} userName={session.user.displayName} />
    </div>
  );
}
