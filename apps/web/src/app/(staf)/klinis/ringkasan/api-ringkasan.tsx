import { type PatientSummary, patientSummarySchema } from '@simrs/shared';
import { Chip } from '@simrs/ui';
import type { ReactNode } from 'react';
import { ApiScreenShell, EncounterBanner, EncounterGate } from '@/components/klinis/encounter-screen';
import { formatTglJam } from '@/lib/rawat-inap';
import { api } from '@/lib/server/api';
import { resolveEncounter } from '@/lib/server/data/klinis/encounter-screen';
import type { SessionView } from '@/lib/session-view';

const ROUTE = '/klinis/ringkasan';
const CLASS_LABEL = { AMB: 'Rawat jalan', EMER: 'IGD', IMP: 'Rawat inap' } as const;
const CARD =
  'flex min-w-0 flex-col gap-2 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card';
const VITAL_LABEL: Record<string, string> = {
  temp: 'Suhu (°C)',
  hr: 'Nadi (x/mnt)',
  rr: 'Napas (x/mnt)',
  sbp: 'TD sistolik',
  dbp: 'TD diastolik',
  spo2: 'SpO2 (%)',
  consciousness: 'Kesadaran',
  o2: 'Oksigen tambahan',
};

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={CARD}>
      <h2 className="m-0 text-body font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 text-small text-ink-500">{children}</p>;
}

/**
 * K14 · Ringkasan pasien mode api (`GET /summary/patients/:id`, seluruh kelompok rekam medis, ADR-0016): alergi,
 * masalah aktif, tanda vital + EWS terakhir, hasil dan tindakan terbaru, obat aktif, riwayat kunjungan. Hanya baca;
 * pembacaan diaudit API per pasien.
 */
export async function ApiRingkasan({
  session,
  searchParams,
}: {
  session: SessionView;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const res = await resolveEncounter(searchParams.kunjungan);
  const crumb = `Klinis / Ringkasan pasien · ${session.tenant.name}`;
  if (res.kind !== 'ok') {
    return (
      <ApiScreenShell crumb={crumb} title="Ringkasan pasien">
        <EncounterGate res={res} route={ROUTE} />
      </ApiScreenShell>
    );
  }
  const s: PatientSummary = await api(`/api/v1/summary/patients/${res.context.patient.id}`, {
    schema: patientSummarySchema,
  });
  const v = s.latestVitals;
  return (
    <ApiScreenShell crumb={crumb} title="Ringkasan pasien">
      <EncounterBanner context={res.context} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Alergi">
          {s.allergies.status === 'belum_dikaji' ? (
            <Chip tone="warning">Alergi belum dikaji</Chip>
          ) : s.allergies.status === 'nkda' ? (
            <Chip tone="success">Tidak ada alergi obat yang diketahui (NKDA)</Chip>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
              {s.allergies.allergies.map((a) => (
                <li key={a.id}>
                  <span className="font-semibold">{a.substance?.name ?? a.text}</span>
                  {a.criticality ? ` · kritikalitas ${a.criticality.replace('_', ' ')}` : ''}
                  {a.reaction ? ` · ${a.reaction}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Masalah aktif">
          {s.activeProblems.length === 0 ? (
            <Empty>Tidak ada masalah aktif tercatat.</Empty>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
              {s.activeProblems.map((p) => (
                <li key={p.id}>
                  <span className="font-mono">{p.code}</span> {p.display}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Tanda vital terakhir">
          {!v ? (
            <Empty>Belum ada observasi tanda vital.</Empty>
          ) : (
            <>
              <span className="flex flex-wrap items-center gap-2 text-small">
                {formatTglJam(v.at)}
                {v.ews && (
                  <Chip tone={v.ews.risk === 'rendah' ? 'success' : 'danger'}>
                    EWS {v.ews.score} · risiko {v.ews.risk}
                  </Chip>
                )}
              </span>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-small">
                {Object.entries(v.values).map(([k, val]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-500">{VITAL_LABEL[k] ?? k}</dt>
                    <dd className="m-0">{typeof val === 'boolean' ? (val ? 'Ya' : 'Tidak') : String(val)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </Card>
        <Card title="Obat aktif">
          {s.activeMedications.length === 0 ? (
            <Empty>Tidak ada order obat aktif.</Empty>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
              {s.activeMedications.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{m.name}</span> {m.sig}
                  {m.highAlert && <Chip tone="danger">Kewaspadaan tinggi</Chip>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Hasil terbaru">
          {s.recentResults.length === 0 ? (
            <Empty>Belum ada hasil penunjang.</Empty>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
              {s.recentResults.map((r) => (
                <li key={r.id}>
                  <span className="font-semibold">{r.display}</span>{' '}
                  {r.valueNumeric !== null
                    ? `${r.valueNumeric}${r.valueUnit ? ` ${r.valueUnit}` : ''}`
                    : r.valueText}
                  {r.interpretation && r.interpretation !== 'normal' ? ` · ${r.interpretation}` : ''} ·{' '}
                  {formatTglJam(r.occurredAt)}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Tindakan terbaru">
          {s.recentProcedures.length === 0 ? (
            <Empty>Belum ada tindakan tercatat.</Empty>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
              {s.recentProcedures.map((p) => (
                <li key={p.id}>
                  <span className="font-mono">{p.code}</span> {p.display} · {formatTglJam(p.occurredAt)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Riwayat kunjungan">
        {s.encounters.length === 0 ? (
          <Empty>Belum ada kunjungan.</Empty>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
            {s.encounters.map((e) => (
              <li key={e.id}>
                <span className="font-semibold">{formatTglJam(e.at)}</span> · {CLASS_LABEL[e.class]} ·{' '}
                {e.unitName} · {e.number}
                {e.primaryDiagnosis ? ` · ${e.primaryDiagnosis.code} ${e.primaryDiagnosis.display}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </ApiScreenShell>
  );
}
