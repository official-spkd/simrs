import { type Claim, CLAIM_STATUSES, type ClaimStatus } from '@simrs/shared';
import { Chip, KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ClaimDetail } from '@/components/keuangan/claim-detail';
import { ClaimList } from '@/components/keuangan/claim-list';
import { ScenarioBanner } from '@/components/scenario-banner';
import { formatRupiahRingkas } from '@/lib/keuangan';
import { defaultSelection, scenarioFlow } from '@/lib/keuangan-skenario';
import { getClaimBoard } from '@/lib/server/data/keuangan';
import { scenarioRuns, scenariosHere } from '@/lib/server/demo/scenario-context';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Klaim & koding' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const num = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

/** U05/U06 · Klaim INA-CBG dan koding (mockup `Klaim.dc.html`). Mode presentasi: data dummy fiktif (ADR-0023). */
export default async function KlaimPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('klaim');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const sp = await searchParams;
  const [board, runs] = await Promise.all([getClaimBoard(session), scenarioRuns(session)]);
  const status = z.enum(CLAIM_STATUSES).optional().catch(undefined).parse(sp.status);
  // Klaim yang dipilih tetap tampil apa pun filternya: filter mengikuti statusnya (mis. terkirim → layak bayar).
  let selected: Claim | null = board.claims.find((c) => c.id === sp.pilih) ?? null;
  if (!selected) {
    // Tanpa pilihan: klaim pasien skenario yang langkahnya aktif di layar ini, dikunci ke URL agar tetap terpilih.
    const here = scenariosHere(runs, 'klaim').map((h) => h.scenario);
    const pool = status ? board.claims.filter((c) => c.status === status) : board.claims;
    const fallback = status ? pool[0] : pool.find((c) => c.status === 'draft');
    const def = defaultSelection(pool, here, runs.active, fallback);
    if (def.item && (def.pin || status)) {
      redirect(`/keuangan/klaim?status=${def.item.status}&pilih=${def.item.id}`);
    }
    selected = def.item ?? null;
  }
  const filter: ClaimStatus = selected?.status ?? status ?? 'draft';
  const flow = selected?.scenario
    ? scenarioFlow(runs.results[selected.scenario], selected.scenario === 'rawat-jalan' ? 'pasca' : 'klaim')
    : null;
  const k = board.kpis;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Keuangan / Casemix / {board.periodLabel} · {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-semibold">Klaim JKN · koding dan grouping</h1>
        </div>
        <Chip tone="success">● E-Klaim terhubung · grouper INA-CBG (simulasi)</Chip>
      </header>

      <ScenarioBanner session={session} screen="klaim" />

      <div
        role="region"
        aria-label="Indikator klaim"
        className="grid grid-cols-2 gap-3.5 md:grid-cols-3 2xl:grid-cols-5"
      >
        <KpiCard
          label="Klaim bulan ini"
          value={num.format(k.claimsMonth.total)}
          detail={`RJ ${num.format(k.claimsMonth.rj)} · RI ${num.format(k.claimsMonth.ri)}`}
        />
        <KpiCard
          label="Nilai diajukan"
          value={formatRupiahRingkas(BigInt(k.submittedValue))}
          detail="periode berjalan"
        />
        <KpiCard
          label="Rata-rata koding"
          value={`${num.format(k.avgCodingDays)} hari`}
          hint="setelah pasien pulang"
          tone="success"
          tinted
        />
        <KpiCard
          label="Pending verifikator"
          value={num.format(k.pending.count)}
          hint={`${formatRupiahRingkas(BigInt(k.pending.value))} tertahan`}
          tone="warning"
          tinted
        />
        <KpiCard
          label="Dispute"
          value={num.format(k.dispute.count)}
          hint={formatRupiahRingkas(BigInt(k.dispute.value))}
          tone="danger"
          tinted
        />
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <ClaimList
          claims={board.claims}
          totals={board.totals}
          filter={filter}
          selectedId={selected?.id ?? null}
        />
        {selected ? (
          <ClaimDetail
            key={`${selected.id}:${selected.status}`}
            claim={selected}
            flow={flow}
            rev={runs.rev}
          />
        ) : (
          <section
            aria-label="Berkas klaim"
            className="flex min-w-0 flex-[999_1_560px] items-center justify-center rounded-card border border-dashed border-line-strong bg-white p-8 text-small text-ink-500"
          >
            Pilih status lain untuk melihat contoh berkas klaim.
          </section>
        )}
      </div>
    </div>
  );
}
