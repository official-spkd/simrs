import { formatRupiah } from '@simrs/shared';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { BillQueue } from '@/components/keuangan/bill-queue';
import { KasirWorkspace } from '@/components/keuangan/kasir-workspace';
import { ShiftClose } from '@/components/keuangan/shift-close';
import { ScenarioBanner } from '@/components/scenario-banner';
import { scenarioFlow } from '@/lib/keuangan-skenario';
import { getKasirBoard } from '@/lib/server/data/keuangan';
import { scenarioRuns } from '@/lib/server/demo/scenario-context';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Kasir' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** U02/U03 · Kasir dan tarif (mockup `Kasir.dc.html`). Mode presentasi: data dummy fiktif (ADR-0023). */
export default async function KasirPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('kasir');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const sp = await searchParams;
  const [board, runs] = await Promise.all([getKasirBoard(session), scenarioRuns(session)]);
  const pick = typeof sp.pilih === 'string' ? sp.pilih : undefined;
  const selected = board.invoices.find((i) => i.id === pick) ?? board.invoices[0];
  if (!selected) return null;
  const flow = selected.scenario ? scenarioFlow(runs.results[selected.scenario], 'kasir') : null;
  const next = board.invoices.find((i) => i.id !== selected.id && i.status !== 'lunas');
  const done = board.invoices.filter((i) => i.status === 'lunas').length;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Keuangan / Kasir · {session.tenant.name}</span>
          <h1 className="m-0 text-h1 font-semibold">Kasir · tagihan pasien</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] text-ink-700">
            {board.shift.label} · {board.shift.counter} · saldo awal{' '}
            {formatRupiah(BigInt(board.shift.openingCash))}
          </span>
          <ShiftClose summary={`${done} tagihan lunas di shift ini`} />
        </div>
      </header>

      <ScenarioBanner session={session} screen="kasir" />

      <div className="flex flex-wrap items-start gap-4">
        <BillQueue invoices={board.invoices} selectedId={selected.id} />
        <KasirWorkspace
          key={`${selected.id}:${selected.status}`}
          invoice={selected}
          flow={flow}
          rev={runs.rev}
          nextHref={next ? `/keuangan/kasir?pilih=${next.id}` : null}
        />
      </div>
    </div>
  );
}
