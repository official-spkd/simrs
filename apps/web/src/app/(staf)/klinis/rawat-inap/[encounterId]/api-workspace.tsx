'use client';

import { formatJam, type PatientResults, type ResultObservationRecord } from '@simrs/shared';
import { cx, TabList, TabPanel } from '@simrs/ui';
import { useId, useState } from 'react';
import { CompletenessCard } from '@/components/klinis/completeness-card';
import { type ConsultMe, ConsultPanel } from '@/components/klinis/consult-panel';
import { PatientDocuments } from '@/components/klinis/patient-documents';
import { ValueFlagBadge } from '@/components/klinis/status-flag';
import { formatTglJam } from '@/lib/rawat-inap';
import type { InpatientRecordView } from '@/lib/server/data/klinis/ranap-api';
import { ApiCareTab } from './api-care';
import { ApiCpptPanel } from './api-cppt';
import { ApiEmarPanel } from './api-emar';
import { ApiObservationTab } from './api-observation';
import { SummaryPanel } from './inpatient-panels';
import { consentLabel, dischargeLabel } from './paperwork';
import type { ApiTab } from './tabs';

export interface Me {
  id: string;
  name: string;
  role: string | null;
}

export interface Perms {
  write: boolean;
  correct: boolean;
  cosign: boolean;
  administer: boolean;
  replaceBand: boolean;
}

/**
 * K04/K07/K12 · Tab rekam rawat inap mode api (layar W4). Data datang dari server (halaman dinamis); setiap aksi
 * memanggil Server Action lalu `router.refresh()`. Keadaan lokal hanya tampilan (tab, formulir, pindaian gelang yang
 * sedang dipakai di layar ini).
 */
export function ApiInpatientWorkspace({
  record,
  initialTab,
  day,
  me,
  perms,
  active,
  ext38,
}: {
  record: InpatientRecordView;
  initialTab: ApiTab;
  day: number;
  me: Me;
  perms: Perms;
  /** Kunjungan sedang berjalan (eMAR hanya untuk kunjungan aktif). */
  active: boolean;
  /** Konteks sesi untuk tab "Dokumen & konsultasi" (3.8): posisi + unit, izin dokumen, jam server render. */
  ext38: { me: ConsultMe; documentsWrite: boolean; now: string };
}) {
  const tabsId = useId();
  const [tab, setTab] = useState<string>(initialTab);
  const c = record.context;
  const enc = c.encounter.id;
  const ext = record.extensions;
  const hasExtensions = ext.consults !== null || ext.completeness !== null || ext.documents !== null;
  const lastNote = [...record.cppt].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  const soapOf = (k: 'a' | 'p') =>
    lastNote && lastNote.content.format === 'soap' ? lastNote.content[k] : '';

  const items = [
    {
      id: 'ringkasan',
      label: 'Ringkasan',
      content: (
        <SummaryPanel
          rows={[
            {
              label: 'Diagnosis',
              value:
                record.conditions.length > 0
                  ? record.conditions
                      .map((d) => `${d.code} ${d.display}${d.role === 'utama' ? ' (utama)' : ''}`)
                      .join(' · ')
                  : 'Belum ada diagnosis tercatat',
            },
            { label: 'DPJP', value: c.dpjp?.name ?? 'Belum ditetapkan' },
            {
              label: 'Hari rawat',
              value: `Ke-${day} · ${c.encounter.unit.name}${c.encounter.bed ? ` ${c.encounter.bed.code}` : ''} · ${c.coverage?.name ?? 'penjamin belum tercatat'}`,
            },
            {
              label: 'Obat aktif',
              value:
                record.emar.orders.length > 0
                  ? record.emar.orders.map((o) => `${o.name} (${o.sig})`).join(' · ')
                  : 'Tidak ada order obat aktif',
            },
            {
              label: 'Keselamatan',
              value: `${
                c.allergy.status === 'ada'
                  ? `Alergi ${c.allergy.labels.join(', ')}`
                  : c.allergy.status === 'nkda'
                    ? 'Tidak ada alergi obat (NKDA)'
                    : 'Alergi belum dikaji'
              }${c.latestEws ? ` · EWS terakhir ${c.latestEws.score} (${c.latestEws.risk}, ${formatJam(c.latestEws.at)})` : ''}`,
            },
            { label: 'Rencana terakhir', value: soapOf('p') || 'Belum ada rencana di CPPT' },
            ...(record.discharge
              ? [{ label: 'Resume medis', value: dischargeLabel(record.discharge) ?? '' }]
              : []),
            ...(record.consents
              ? [{ label: 'Persetujuan tindakan', value: consentLabel(record.consents) ?? '' }]
              : []),
          ]}
          links={[]}
        />
      ),
    },
    {
      id: 'cppt',
      label: 'CPPT & SBAR',
      content: (
        <ApiCpptPanel
          encounterId={enc}
          entries={record.cppt}
          handovers={record.handovers}
          me={me}
          perms={perms}
          sbarDraft={{
            situation: soapOf('a') ? `${soapOf('a')} (${lastNote?.author.nama})` : '',
            background:
              `${c.primaryDiagnosis ? `${c.primaryDiagnosis.code} ${c.primaryDiagnosis.display}` : 'Diagnosis kerja'}, hari rawat ke-${day}. ${c.allergy.status === 'ada' ? `Alergi ${c.allergy.labels.join(', ')}.` : ''}`.trim(),
            assessment: c.latestEws
              ? `EWS terakhir ${c.latestEws.score} (risiko ${c.latestEws.risk}) pukul ${formatJam(c.latestEws.at)}.`
              : '',
            recommendation: soapOf('p'),
          }}
        />
      ),
    },
    {
      id: 'emar',
      label: 'eMAR',
      content: (
        <ApiEmarPanel
          encounterId={enc}
          board={record.emar}
          patient={{ name: c.patient.name, mrn: c.patient.mrn }}
          scans={record.scans ?? []}
          checks={record.doubleChecks ?? []}
          me={me}
          perms={perms}
          active={active}
        />
      ),
    },
    {
      id: 'obs',
      label: 'Observasi & EWS',
      content: <ApiObservationTab encounterId={enc} vitals={record.vitals} me={me} canWrite={perms.write} />,
    },
    {
      id: 'askep',
      label: 'Asuhan keperawatan',
      content: (
        <ApiCareTab
          encounterId={enc}
          plans={record.carePlans}
          diagnoses={record.nursingDiagnoses}
          fluids={record.fluids}
          me={me}
          perms={perms}
        />
      ),
    },
    { id: 'hasil', label: 'Hasil', content: <ApiResults results={record.results} /> },
    ...(hasExtensions
      ? [
          {
            id: 'dokumen',
            label: 'Dokumen & konsultasi',
            content: (
              <div className="flex flex-col gap-4">
                {ext.completeness && <CompletenessCard data={ext.completeness} />}
                {ext.consults && (
                  <ConsultPanel
                    encounterId={enc}
                    consults={ext.consults.requests}
                    team={ext.consults.team}
                    me={ext38.me}
                    now={ext38.now}
                    canWrite={perms.write}
                  />
                )}
                {ext.documents && (
                  <PatientDocuments
                    patientId={c.patient.id}
                    documents={ext.documents}
                    canWrite={ext38.documentsWrite}
                    path={`/klinis/rawat-inap/${enc}`}
                  />
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  const current = items.find((t) => t.id === tab) ?? items[1] ?? items[0];
  if (!current) return null;
  return (
    <div className="flex flex-col gap-3">
      <TabList
        label="Bagian rekam rawat inap"
        idBase={tabsId}
        value={current.id}
        onChange={setTab}
        items={items.map(({ id, label }) => ({ id, label }))}
      />
      <TabPanel key={current.id} idBase={tabsId} value={current.id}>
        {current.content}
      </TabPanel>
    </div>
  );
}

const FLAG_LABEL: Record<string, string> = {
  normal: 'Normal',
  tinggi: 'Tinggi',
  rendah: 'Rendah',
  abnormal: 'Abnormal',
  kritis: 'Kritis',
};

function valueText(o: ResultObservationRecord): string {
  if (o.valueNumeric !== null) {
    return `${String(o.valueNumeric).replace('.', ',')}${o.valueUnit ? ` ${o.valueUnit}` : ''}`;
  }
  return o.valueText ?? '–';
}

function ResultRow({ o }: { o: ResultObservationRecord }) {
  const flag = o.interpretation;
  return (
    <li className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-0.5 border-b border-line-soft px-4 py-2.5 text-small sm:grid-cols-[130px_1fr_1.4fr_96px]">
      <span className="font-mono text-caption text-ink-500">{formatTglJam(o.occurredAt)}</span>
      <span className="font-semibold">{o.display}</span>
      <span className="col-span-2 sm:col-span-1">
        {valueText(o)}
        {o.referenceRange ? (
          <span className="text-caption text-ink-500"> · rujukan {o.referenceRange}</span>
        ) : null}
      </span>
      <span>
        {flag === 'tinggi' || flag === 'rendah' || flag === 'kritis' ? (
          <ValueFlagBadge flag={flag} />
        ) : (
          <span
            className={cx(
              'text-caption font-semibold',
              flag === 'abnormal' ? 'text-warning' : 'text-success',
            )}
          >
            {flag ? FLAG_LABEL[flag] : 'Tanpa interpretasi'}
          </span>
        )}
      </span>
    </li>
  );
}

/** Hasil laboratorium/radiologi kunjungan ini (laporan + hasil tanpa laporan), penanda selalu bertulisan. */
function ApiResults({ results }: { results: PatientResults | null }) {
  if (!results) {
    return (
      <p className="m-0 rounded-card border border-white/95 bg-white/90 px-4 py-3 text-small text-ink-500 shadow-card">
        Peran Anda tidak berizin membaca hasil penunjang.
      </p>
    );
  }
  const empty = results.reports.length === 0 && results.observations.length === 0;
  return (
    <section
      aria-label="Hasil penunjang"
      className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
    >
      <h2 className="m-0 border-b border-line px-4 py-3 text-body font-semibold">
        Hasil laboratorium dan radiologi
      </h2>
      {results.reports.map((r) => (
        <div key={r.id} className="border-b border-line">
          <div className="flex flex-wrap items-baseline justify-between gap-2 bg-subtle px-4 py-2">
            <span className="font-semibold">
              {r.display} <span className="text-caption font-normal text-ink-500">· {r.category}</span>
            </span>
            <span className="text-caption text-ink-500">
              {formatTglJam(r.occurredAt)} · {r.author.nama}
            </span>
          </div>
          {r.conclusion && <p className="m-0 px-4 py-2 text-small">Kesimpulan: {r.conclusion}</p>}
          <ul className="m-0 list-none p-0">
            {r.observations.map((o) => (
              <ResultRow key={o.id} o={o} />
            ))}
          </ul>
        </div>
      ))}
      {results.observations.length > 0 && (
        <ul className="m-0 list-none p-0" aria-label="Hasil tanpa laporan">
          {results.observations.map((o) => (
            <ResultRow key={o.id} o={o} />
          ))}
        </ul>
      )}
      {empty && (
        <p className="m-0 px-4 py-3 text-small text-ink-500">
          Belum ada hasil penunjang untuk kunjungan ini.
        </p>
      )}
    </section>
  );
}
