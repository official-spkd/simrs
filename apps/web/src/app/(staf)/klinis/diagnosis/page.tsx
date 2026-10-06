import type { Metadata } from 'next';
import { RmeChartHeader } from '@/components/rme/chart-header';
import { DiagnosisWorkspace } from '@/components/rme/diagnosis-workspace';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import {
  allergyList,
  encounterCoding,
  problemList,
  RME_ICD10,
  RME_ICD9,
} from '@/lib/demo/fixtures/rme-diagnosis';
import { chartPatient } from '@/lib/demo/fixtures/rme-pasien';
import { DEMO_NOW, DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { rmeChartFor } from '@/lib/server/data/klinis/rme';

export const metadata: Metadata = { title: 'Diagnosis & problem list' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K08 · Diagnosis kunjungan ICD-10 (tepat satu utama), prosedur ICD-9-CM, problem list lintas kunjungan, alergi/NKDA
 * (`?pasien=`). Mode presentasi (ADR-0023); backend `POST /api/v1/diagnosis/…` menyusul (rencana fase 3 · 3.2a).
 */
export default async function DiagnosisPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('diagnosis');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const chart = rmeChartFor((await searchParams).pasien);
  const role = session.role?.code ?? null;
  const { dx, procedures } = encounterCoding(chart);
  const allergies = allergyList(chart, chartPatient(chart).alergi);

  return (
    <div className="flex flex-col gap-4">
      <RmeChartHeader
        chart={chart}
        screenId="diagnosis"
        title="Diagnosis & problem list"
        tenantName={session.tenant.name}
        role={role}
        asOf={DEMO_NOW}
      />
      <DiagnosisWorkspace
        key={chart.encounterId}
        encounterId={chart.encounterId}
        role={role}
        user={session.user.displayName}
        today={DEMO_TODAY}
        icd10={RME_ICD10}
        icd9={RME_ICD9}
        initialDx={dx}
        initialProcedures={procedures}
        initialProblems={problemList(chart, dx)}
        initialAllergies={allergies.list}
        initialNkdaAt={allergies.nkdaAt}
      />
    </div>
  );
}
