import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { CostingWorkspace } from '@/components/keuangan/costing-workspace';
import { getCostingBoard } from '@/lib/server/data/keuangan-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Costing & case-mix' };

/**
 * I10 · Costing dan case-mix (tanpa mockup; modul lanjutan RS tersier): biaya per kasus vs INA-CBG, margin per
 * kelompok kasus dan DPJP, varians clinical pathway. Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function CostingPage() {
  const { session, screen, allowed } = await requireDemoScreen('costing');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const board = getCostingBoard();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Keuangan / Costing & case-mix · {session.tenant.name}
        </span>
        <h1 className="m-0 text-h1 font-semibold">Costing & case-mix · biaya per kasus vs INA-CBG</h1>
      </header>
      <CostingWorkspace board={board} />
    </div>
  );
}
