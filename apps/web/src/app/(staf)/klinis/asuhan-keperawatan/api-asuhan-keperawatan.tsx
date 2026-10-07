import {
  fluidBalanceDaySchema,
  nursingCarePlanRecordSchema,
  nursingDiagnosisOptionSchema,
} from '@simrs/shared';
import { ApiScreenShell, EncounterBanner, EncounterGate } from '@/components/klinis/encounter-screen';
import { api } from '@/lib/server/api';
import { resolveEncounter } from '@/lib/server/data/klinis/encounter-screen';
import { can, type SessionView } from '@/lib/session-view';
import { ApiCareTab } from '../rawat-inap/[encounterId]/api-care';

const ROUTE = '/klinis/asuhan-keperawatan';

/**
 * K12 · Asuhan keperawatan mode api: rencana asuhan per diagnosis keperawatan (berversi; evaluasi = versi baru
 * beralasan) dan balans cairan hari ini, satu kunjungan. Panel sama dengan tab Askep Rawat inap (W4). Pemberian obat
 * (eMAR + gelang) ada di tab eMAR Rawat inap.
 */
export async function ApiAskep({
  session,
  searchParams,
}: {
  session: SessionView;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const res = await resolveEncounter(searchParams.kunjungan);
  const crumb = `Klinis / Asuhan keperawatan · ${session.tenant.name}`;
  if (res.kind !== 'ok') {
    return (
      <ApiScreenShell crumb={crumb} title="Asuhan keperawatan">
        <EncounterGate res={res} route={ROUTE} />
      </ApiScreenShell>
    );
  }
  const c = res.context;
  const enc = `/api/v1/encounters/${c.encounter.id}`;
  const [plans, diagnoses, fluids] = await Promise.all([
    api(`${enc}/care-plans`, { schema: nursingCarePlanRecordSchema.array() }),
    api('/api/v1/nursing/diagnoses', { schema: nursingDiagnosisOptionSchema.array() }),
    api(`${enc}/fluid-balances`, { schema: fluidBalanceDaySchema }),
  ]);
  return (
    <ApiScreenShell crumb={crumb} title="Asuhan keperawatan">
      <EncounterBanner context={c} />
      <ApiCareTab
        encounterId={c.encounter.id}
        plans={plans}
        diagnoses={diagnoses}
        fluids={fluids}
        me={{ id: session.user.id, name: session.user.displayName, role: session.role?.name ?? null }}
        perms={{
          write: can(session, 'clinical', 'write'),
          correct: can(session, 'clinical', 'correct'),
          cosign: can(session, 'clinical', 'cosign'),
          administer: can(session, 'medication', 'administer'),
          replaceBand: false,
        }}
      />
    </ApiScreenShell>
  );
}
