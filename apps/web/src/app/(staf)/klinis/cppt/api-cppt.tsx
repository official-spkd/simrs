import { cpptRecordSchema, handoverRecordSchema } from '@simrs/shared';
import { ApiScreenShell, EncounterBanner, EncounterGate } from '@/components/klinis/encounter-screen';
import { api } from '@/lib/server/api';
import { resolveEncounter } from '@/lib/server/data/klinis/encounter-screen';
import { can, type SessionView } from '@/lib/session-view';
import { ApiCpptPanel } from '../rawat-inap/[encounterId]/api-cppt';

const ROUTE = '/klinis/cppt';

/**
 * K07 · CPPT & serah terima mode api: CPPT multi-PPA satu kunjungan (rawat jalan, IGD, rawat inap) dengan co-sign
 * residen, verifikasi DPJP, koreksi/addendum, dan SBAR. Panel sama dengan tab CPPT Rawat inap (W4); API menegakkan PPA
 * dari sesi, co-sign hanya DPJP, dan versi entri.
 */
export async function ApiCppt({
  session,
  searchParams,
}: {
  session: SessionView;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const res = await resolveEncounter(searchParams.kunjungan);
  const crumb = `Klinis / CPPT & serah terima · ${session.tenant.name}`;
  if (res.kind !== 'ok') {
    return (
      <ApiScreenShell crumb={crumb} title="CPPT & serah terima">
        <EncounterGate res={res} route={ROUTE} />
      </ApiScreenShell>
    );
  }
  const c = res.context;
  const enc = `/api/v1/encounters/${c.encounter.id}`;
  const [entries, handovers] = await Promise.all([
    api(`${enc}/cppt`, { schema: cpptRecordSchema.array() }),
    api(`${enc}/handovers`, { schema: handoverRecordSchema.array() }),
  ]);
  const last = [...entries].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  const soap = last && last.content.format === 'soap' ? last.content : null;
  return (
    <ApiScreenShell crumb={crumb} title="CPPT & serah terima">
      <EncounterBanner context={c} />
      <ApiCpptPanel
        encounterId={c.encounter.id}
        entries={entries}
        handovers={handovers}
        me={{ id: session.user.id, name: session.user.displayName, role: session.role?.name ?? null }}
        perms={{
          write: can(session, 'clinical', 'write'),
          correct: can(session, 'clinical', 'correct'),
          cosign: can(session, 'clinical', 'cosign'),
          administer: can(session, 'medication', 'administer'),
          replaceBand: false,
        }}
        sbarDraft={{
          situation: soap?.a ? `${soap.a} (${last?.author.nama})` : '',
          background: c.primaryDiagnosis
            ? `${c.primaryDiagnosis.code} ${c.primaryDiagnosis.display}`
            : 'Diagnosis kerja belum dicatat',
          assessment: c.latestEws ? `EWS terakhir ${c.latestEws.score} (risiko ${c.latestEws.risk}).` : '',
          recommendation: soap?.p ?? '',
        }}
      />
    </ApiScreenShell>
  );
}
