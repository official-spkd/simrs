import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { PiutangWorkspace } from '@/components/keuangan/piutang-workspace';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { getReceivablesBoard } from '@/lib/server/data/keuangan-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { readDomain } from '@/lib/server/demo/state';
import { applyAgingDelta } from '@/lib/keuangan-akuntansi-toko';

export const metadata: Metadata = { title: 'Penjaminan & piutang' };

/**
 * U04 · Penjaminan dan piutang (tanpa mockup; rencana fase 5 potongan 5.6). Mode presentasi: data dummy fiktif,
 * penagihan, pelunasan, dan penyesuaian tersimpan di toko demo (domain `piutang`, ADR-0085).
 */
export default async function PiutangPage() {
  const { session, screen, allowed } = await requireDemoScreen('piutang');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const board = getReceivablesBoard();
  const [{ state, rev }, ak] = await Promise.all([readDomain('piutang'), readDomain('akuntansi')]);
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Keuangan / Penjaminan & piutang / Periode Oktober 2026 · {session.tenant.name}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Penjaminan & piutang · tagih dan lunasi</h1>
      </header>
      <PiutangWorkspace
        board={{ ...board, aging: applyAgingDelta(board.aging, ak.state) }}
        store={state}
        rev={rev}
        today={DEMO_TODAY}
        viewer={{ id: session.user.id, name: session.user.displayName, role: session.role?.code ?? null }}
      />
    </div>
  );
}
