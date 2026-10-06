import type { Metadata } from 'next';
import { RmeChartHeader } from '@/components/rme/chart-header';
import { KelengkapanWorkspace } from '@/components/rme/kelengkapan-workspace';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { closeChecklist, patientDocuments } from '@/lib/demo/fixtures/rme-kelengkapan';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { openRoute } from '@/lib/rme';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { rmeChartFor } from '@/lib/server/data/klinis/rme';

export const metadata: Metadata = { title: 'Kelengkapan rekam medis' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FIX_SCREENS = ['asesmen', 'diagnosis', 'edukasi', 'resume', 'cppt'];

/**
 * K13 · Dokumen pasien dan kelengkapan rekam medis per kunjungan (`?pasien=`): daftar periksa DPJP dan gerbang tutup
 * kunjungan (EP 5c). Mode presentasi (ADR-0023); backend `GET /api/v1/assessment/encounters/:id/completeness` dan
 * `DischargeGate` menyusul (rencana fase 3 · 3.6, 3.8).
 */
export default async function KelengkapanPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('kelengkapan');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const chart = rmeChartFor((await searchParams).pasien);
  const role = session.role?.code ?? null;
  const docs = patientDocuments(chart);
  const routes = Object.fromEntries(FIX_SCREENS.map((s) => [s, openRoute(s, role)]));

  return (
    <div className="flex flex-col gap-4">
      <RmeChartHeader
        chart={chart}
        screenId="kelengkapan"
        title="Kelengkapan rekam medis"
        tenantName={session.tenant.name}
        role={role}
        asOf={DEMO_NOW}
      />
      <KelengkapanWorkspace
        key={chart.encounterId}
        encounterId={chart.encounterId}
        role={role}
        user={session.user.displayName}
        initialDocs={docs}
        initialItems={closeChecklist(chart, docs)}
        routes={routes}
      />
    </div>
  );
}
