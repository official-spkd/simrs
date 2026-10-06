import type { Metadata } from 'next';
import { AsesmenWorkspace } from '@/components/rme/asesmen-workspace';
import { RmeChartHeader } from '@/components/rme/chart-header';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import {
  ASSESSMENT_PACKAGES,
  assessmentForm,
  assessmentResponsesFor,
  ENCOUNTER_START_HM,
} from '@/lib/demo/fixtures/rme-asesmen';
import { chartPatient, RME_SETTING_LABEL } from '@/lib/demo/fixtures/rme-pasien';
import { at } from '@/lib/demo/fixtures/rawat-inap';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import type { AssessmentForm } from '@/lib/rme-asesmen';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { rmeChartFor } from '@/lib/server/data/klinis/rme';

export const metadata: Metadata = { title: 'Asesmen & skrining' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K06 · Asesmen dan skrining per kunjungan (`?pasien=`): paket formulir per setting lewat penyaji formulir P07, skor
 * otomatis, hak tulis per profesi, koreksi berversi. Mode presentasi (ADR-0023); backend `POST /api/v1/forms/
 * responses` dengan `encounterId` menyusul (rencana fase 3 · 3.2b).
 */
export default async function AsesmenPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('asesmen');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const chart = rmeChartFor((await searchParams).pasien);
  const role = session.role?.code ?? null;
  const forms = ASSESSMENT_PACKAGES[chart.setting].flatMap((c): AssessmentForm[] => {
    const f = assessmentForm(c);
    return f ? [f] : [];
  });
  const startedAt = at(chart.startedOn, ENCOUNTER_START_HM[chart.encounterId] ?? '08.00');

  return (
    <div className="flex flex-col gap-4">
      <RmeChartHeader
        chart={chart}
        screenId="asesmen"
        title="Asesmen & skrining"
        tenantName={session.tenant.name}
        role={role}
        asOf={DEMO_NOW}
      />
      <AsesmenWorkspace
        key={chart.encounterId}
        encounterId={chart.encounterId}
        settingLabel={RME_SETTING_LABEL[chart.setting]}
        forms={forms}
        initialResponses={assessmentResponsesFor({ ...chart, riwayat: chartPatient(chart).riwayat })}
        startedAt={startedAt}
        now={DEMO_NOW}
        role={role}
        user={session.user.displayName}
      />
    </div>
  );
}
