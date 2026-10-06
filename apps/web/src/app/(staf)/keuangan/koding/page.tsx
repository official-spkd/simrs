import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { KodingWorkspace } from '@/components/keuangan/koding-workspace';
import { codingList } from '@/lib/keuangan-klaim-toko';
import { getCodingBoard } from '@/lib/server/data/keuangan-lanjut';
import { readDomain } from '@/lib/server/demo/state';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Workbench koder' };

/**
 * U06 · Workbench koder (tanpa mockup; melengkapi layar Klaim, rencana fase 5 potongan 5.5): validasi kode dari RME,
 * bukti, query DPJP, versi koding. Mode presentasi: data dummy fiktif (ADR-0023) + toko demo (domain `klaim`,
 * ADR-0085): tindakan koder tersimpan, kode RME baru masuk, dan validasi mengubah status klaim pasien yang sama.
 */
export default async function KodingPage() {
  const { session, screen, allowed } = await requireDemoScreen('koding');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const board = getCodingBoard();
  const { state, rev } = await readDomain('klaim');
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Keuangan / Workbench koder · {session.tenant.name}</span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Workbench koder · validasi kode dari RME</h1>
      </header>
      <KodingWorkspace board={board} berkas={codingList(state)} reminders={state.reminders} rev={rev} />
    </div>
  );
}
