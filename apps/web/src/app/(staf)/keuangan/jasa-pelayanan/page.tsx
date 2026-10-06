import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { JaspelWorkspace } from '@/components/keuangan/jaspel-workspace';
import { getFeeSharingBoard } from '@/lib/server/data/keuangan-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Jasa pelayanan' };

/**
 * U08 · Jasa pelayanan (tanpa mockup; rencana fase 5 potongan 5.9): rekap per PPA, persetujuan, ekspor, jurnal.
 * Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function JasaPelayananPage() {
  const { session, screen, allowed } = await requireDemoScreen('jaspel');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const board = getFeeSharingBoard();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Keuangan / Jasa pelayanan · {session.tenant.name}</span>
        <h1 className="m-0 text-h1 font-semibold">Jasa pelayanan · rekap per PPA</h1>
      </header>
      <JaspelWorkspace
        board={board}
        viewer={{ name: session.user.displayName, role: session.role?.code ?? null }}
      />
    </div>
  );
}
