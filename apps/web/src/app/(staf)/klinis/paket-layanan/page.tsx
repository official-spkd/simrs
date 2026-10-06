import { cx } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { RmeChartHeader } from '@/components/rme/chart-header';
import { PaketWorkspace } from '@/components/rme/paket-workspace';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ENCOUNTER_ID } from '@/lib/demo/fixtures/ids';
import { patientById } from '@/lib/demo/fixtures/pasien';
import { demoCarePackages } from '@/lib/demo/fixtures/rme-paket';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { rmeChart } from '@/lib/server/data/klinis/rme';
import { applyPaket } from '@/lib/rme-paket-toko';
import { formatJam } from '@simrs/shared';

export const metadata: Metadata = { title: 'Paket layanan khusus' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K15 · Paket layanan khusus (`?pasien=`, bawaan kemoterapi Ny. Maria): hemodialisis, kemoterapi, antenatal; jadwal
 * sesi, kelengkapan per sesi, gerbang lab, mulai/selesai sesi. Mode presentasi (ADR-0023): paket fixture + toko demo
 * `rekam-medis` (ADR-0085); backend `GET /api/v1/care-packages` menyusul (rencana fase 3 · 3.8).
 */
export default async function PaketPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('paket');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const { chart, state, rev } = await rmeChart((await searchParams).pasien, ENCOUNTER_ID.maria);
  const role = session.role?.code ?? null;
  const packages = demoCarePackages();
  const base = packages.find((p) => p.encounterId === chart.encounterId);
  const view = base ? applyPaket(base, state.paket[base.encounterId], formatJam) : null;

  return (
    <div className="flex flex-col gap-4">
      <RmeChartHeader
        chart={chart}
        screenId="paket"
        title="Paket layanan khusus"
        tenantName={session.tenant.name}
        role={role}
        asOf={DEMO_NOW}
      />
      <nav aria-label="Paket aktif" className="flex flex-wrap gap-1.5">
        {packages.map((p) => {
          const on = p.encounterId === chart.encounterId;
          return (
            <Link
              key={p.id}
              href={`${screen.route}?pasien=${p.encounterId}`}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'inline-flex h-11 items-center rounded-full border px-3.5 text-small no-underline',
                on
                  ? 'border-transparent bg-nav-active font-semibold text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]'
                  : 'border-line-strong bg-white/90 text-ink-700 hover:bg-brand-50/60',
              )}
            >
              {p.title} · {patientById(p.patientId)?.nama}
            </Link>
          );
        })}
      </nav>
      {view ? (
        <PaketWorkspace
          key={view.pkg.id}
          pkg={view.pkg}
          decision={view.decision}
          gate={view.gate}
          rev={rev}
          role={role}
        />
      ) : (
        <p className="m-0 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5 text-small text-ink-700">
          Pasien ini tidak mengikuti paket layanan khusus. Pilih paket aktif di atas.
        </p>
      )}
    </div>
  );
}
