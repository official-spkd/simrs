import { formatRupiah, isoDateJakarta } from '@simrs/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { BillQueue } from '@/components/keuangan/bill-queue';
import { KasirWorkspace } from '@/components/keuangan/kasir-workspace';
import { ShiftClose } from '@/components/keuangan/shift-close';
import { ScenarioBanner } from '@/components/scenario-banner';
import { settledCount } from '@/lib/keuangan';
import { defaultSelection, scenarioFlow } from '@/lib/keuangan-skenario';
import { getKasirStore } from '@/lib/server/data/keuangan';
import { scenarioRuns, scenariosHere } from '@/lib/server/demo/scenario-context';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Kasir' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * U02/U03 · Kasir dan tarif (mockup `Kasir.dc.html`). Mode presentasi: data dummy fiktif (ADR-0023) + toko demo
 * bersama (domain `tagihan`, ADR-0085): tagihan baru dari pendaftaran, item manual, final, bayar, tutup, dan shift.
 */
export default async function KasirPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('kasir');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const sp = await searchParams;
  const [store, runs] = await Promise.all([getKasirStore(session), scenarioRuns(session)]);
  const { board } = store;
  const pick = typeof sp.pilih === 'string' ? sp.pilih : undefined;
  let selected = board.invoices.find((i) => i.id === pick);
  if (!selected) {
    // Tanpa pilihan: pasien skenario yang langkah Kasir-nya aktif, dikunci ke URL agar tetap terpilih sampai
    // semua tugas kasir selesai (antrean menurunkan tagihan lunas, jadi urutan bisa berubah).
    const here = scenariosHere(runs, 'kasir').map((h) => h.scenario);
    const def = defaultSelection(board.invoices, here, runs.active, board.invoices[0]);
    if (def.item && def.pin) redirect(`/keuangan/kasir?pilih=${def.item.id}`);
    selected = def.item;
  }
  if (!selected) return null;
  const flow = selected.scenario ? scenarioFlow(runs.results[selected.scenario], 'kasir') : null;
  const selectedId = selected.id;
  const next = board.invoices.find((i) => i.id !== selectedId && i.status !== 'lunas');
  const done = settledCount(board.invoices, isoDateJakarta(board.asOf));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Keuangan / Kasir · {session.tenant.name}</span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Kasir · tagihan pasien</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] text-ink-700">
            {board.shift.label} · {board.shift.counter} · saldo awal{' '}
            {formatRupiah(BigInt(board.shift.openingCash))}
          </span>
          <ShiftClose
            summary={`${done} tagihan lunas di shift ini`}
            shift={store.state.shift}
            rev={store.rev}
          />
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
          storeRev={store.rev}
          held={store.held.get(selected.patient.rm) ?? 0}
          shiftClosed={!!store.state.shift.closedAt}
          nextHref={next ? `/keuangan/kasir?pilih=${next.id}` : null}
        />
      </div>
    </div>
  );
}
