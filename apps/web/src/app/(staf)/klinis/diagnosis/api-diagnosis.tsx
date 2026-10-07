import { conditionRecordSchema, patientAllergiesSchema, procedureRecordSchema } from '@simrs/shared';
import { DiagnosisApi } from '@/components/klinis/diagnosis-api';
import { ApiScreenShell, EncounterBanner, EncounterGate } from '@/components/klinis/encounter-screen';
import { api } from '@/lib/server/api';
import { resolveEncounter } from '@/lib/server/data/klinis/encounter-screen';
import { can, type SessionView } from '@/lib/session-view';

const ROUTE = '/klinis/diagnosis';

/**
 * K08 · Diagnosis & problem list mode api: data dari `/encounters/:id/{conditions,procedures}` dan
 * `/diagnosis/{problem-list,allergies}?patientId=` (seluruh kelompok rekam medis), tulis lewat `/diagnosis/*`.
 */
export async function ApiDiagnosis({
  session,
  searchParams,
}: {
  session: SessionView;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const res = await resolveEncounter(searchParams.kunjungan);
  const crumb = `Klinis / Diagnosis & problem list · ${session.tenant.name}`;
  if (res.kind !== 'ok') {
    return (
      <ApiScreenShell crumb={crumb} title="Diagnosis & problem list">
        <EncounterGate res={res} route={ROUTE} />
      </ApiScreenShell>
    );
  }
  const c = res.context;
  const enc = `/api/v1/encounters/${c.encounter.id}`;
  const [conditions, procedures, problems, allergies] = await Promise.all([
    api(`${enc}/conditions`, { schema: conditionRecordSchema.array() }),
    api(`${enc}/procedures`, { schema: procedureRecordSchema.array() }),
    api(`/api/v1/diagnosis/problem-list?patientId=${c.patient.id}`, {
      schema: conditionRecordSchema.array(),
    }),
    api(`/api/v1/diagnosis/allergies?patientId=${c.patient.id}`, { schema: patientAllergiesSchema }),
  ]);
  return (
    <ApiScreenShell crumb={crumb} title="Diagnosis & problem list">
      <EncounterBanner context={c} />
      <DiagnosisApi
        patientId={c.patient.id}
        encounterId={c.encounter.id}
        conditions={conditions.filter((x) => x.kind === 'encounter')}
        problems={problems}
        procedures={procedures}
        allergies={allergies}
        canWrite={can(session, 'clinical', 'write')}
        canCorrect={can(session, 'clinical', 'correct')}
      />
    </ApiScreenShell>
  );
}
