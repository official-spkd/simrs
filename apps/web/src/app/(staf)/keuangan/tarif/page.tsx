import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { TarifWorkspace } from '@/components/keuangan/tarif-workspace';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { getTariffBoard } from '@/lib/server/data/keuangan-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { readDomain } from '@/lib/server/demo/state';

export const metadata: Metadata = { title: 'Tarif & paket' };

/**
 * U01 · Tarif dan paket (tanpa mockup; rencana fase 5 potongan 5.2). Mode presentasi: data dummy fiktif, usulan dan
 * persetujuan disimulasikan di layar (ADR-0023).
 */
export default async function TarifPage() {
  const { session, screen, allowed } = await requireDemoScreen('tarif');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const board = getTariffBoard();
  const { state, rev } = await readDomain('tarif');
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Keuangan / Tarif & paket · {session.tenant.name}</span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Tarif & paket · master tarif berversi</h1>
      </header>
      <TarifWorkspace
        board={board}
        store={state}
        rev={rev}
        today={DEMO_TODAY}
        viewer={{ name: session.user.displayName, role: session.role?.code ?? null }}
      />
    </div>
  );
}
