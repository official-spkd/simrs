import type { Metadata } from 'next';
import { RmeChartHeader } from '@/components/rme/chart-header';
import { EdukasiWorkspace } from '@/components/rme/edukasi-workspace';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { consentIdOf } from '@/lib/demo/fixtures/pasien';
import { CONSENT_IDS } from '@/lib/demo/fixtures/rawat-inap';
import { DEFAULT_RECIPIENT, EDU_RECORDS, requiredTopics } from '@/lib/demo/fixtures/rme-edukasi';
import { chartPatient } from '@/lib/demo/fixtures/rme-pasien';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { openRoute } from '@/lib/rme';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { rmeChartFor } from '@/lib/server/data/klinis/rme';

export const metadata: Metadata = { title: 'Edukasi pasien' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const EDUCATORS = ['dokter', 'dokter_residen', 'perawat', 'bidan'];

/**
 * K11 · Edukasi pasien dan keluarga terintegrasi (`?pasien=`), melengkapi persetujuan tindakan di tablet. Mode
 * presentasi (ADR-0023); backend lewat formulir P07 menyusul (rencana fase 3 · 3.7).
 */
export default async function EdukasiPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('edukasi');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const chart = rmeChartFor((await searchParams).pasien);
  const p = chartPatient(chart);
  const role = session.role?.code ?? null;
  const consentRoute = openRoute('consent', role);
  const consentId = consentIdOf(p.id);
  const consentHref = consentRoute && CONSENT_IDS.includes(consentId) ? `${consentRoute}/${consentId}` : null;

  return (
    <div className="flex flex-col gap-4">
      <RmeChartHeader
        chart={chart}
        screenId="edukasi"
        title="Edukasi pasien"
        tenantName={session.tenant.name}
        role={role}
        asOf={DEMO_NOW}
      />
      <EdukasiWorkspace
        key={chart.encounterId}
        encounterId={chart.encounterId}
        role={role}
        user={session.user.displayName}
        canEducate={!!role && EDUCATORS.includes(role)}
        required={requiredTopics(chart)}
        initialRecords={EDU_RECORDS[chart.encounterId] ?? []}
        defaultRecipient={DEFAULT_RECIPIENT[chart.encounterId] ?? p.nama}
        consentHref={consentHref}
      />
    </div>
  );
}
