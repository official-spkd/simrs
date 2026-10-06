import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { KasBankWorkspace } from '@/components/keuangan/kasbank-workspace';
import { getCashBankBoard } from '@/lib/server/data/keuangan-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Kas & bank' };

/**
 * U09 · Kas dan bank (tanpa mockup; rencana fase 5 potongan 5.7–5.8): laci kasir dan rekonsiliasi dasar mutasi BTN.
 * Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function KasBankPage() {
  const { session, screen, allowed } = await requireDemoScreen('kas-bank');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const board = getCashBankBoard();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Keuangan / Kas & bank / Sen, 5 Okt 2026 · {session.tenant.name}
        </span>
        <h1 className="m-0 text-h1 font-semibold">Kas & bank · laci kasir dan mutasi rekening</h1>
      </header>
      <KasBankWorkspace board={board} viewer={session.user.displayName} />
    </div>
  );
}
