import { formatTanggalWaktu } from '@simrs/shared';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { DiagnosticWorkspace } from '@/components/penunjang/diagnostik-workspace';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getDiagOrders } from '@/lib/server/data/penunjang-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Diagnostik lain' };

/**
 * S10 · Penunjang diagnostik lain (EKG, ekokardiografi, endoskopi, rehabilitasi medik): order → jadwal → hasil /
 * ekspertise ber-TTE. Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function DiagnostikPage() {
  const { session, screen, allowed } = await requireDemoScreen('diagnostik');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const data = await getDiagOrders();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Penunjang / Diagnostik lain · S10 · {session.tenant.name} · data per {formatTanggalWaktu(data.asOf)}
        </span>
        <h1 className="m-0 text-h1 font-semibold">
          Diagnostik lain · EKG, ekokardiografi, endoskopi, rehab medik
        </h1>
      </header>
      <ScenarioBanner session={session} screen="diagnostik" />
      <DiagnosticWorkspace orders={data.orders} rev={data.rev} userName={session.user.displayName} />
    </div>
  );
}
