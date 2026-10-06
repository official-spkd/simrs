'use client';

import type { InpatientDetail } from '@simrs/shared';
import { TabList, TabPanel } from '@simrs/ui';
import { useId, useState } from 'react';
import { taskDone, taskEnabled, useScenarioTask } from '@/components/rawat-inap/use-scenario-task';
import { emarTurnBlocker, gdsTrend, nursingShift } from '@/lib/rawat-inap';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';
import type { EmarLogLine } from '@/lib/rme-toko';
import { CpptPanel } from './cppt-panel';
import { DayJumps } from './day-jumps';
import { type EmarLocal, EmarPanel } from './emar-panel';
import { EwsPanel, MonitoringTiles, NursingPanel, ResultsPanel, SummaryPanel } from './inpatient-panels';
import type { InpatientTab } from './tabs';

/**
 * K04/K07/K12 · Lima tab rekam rawat inap. CPPT, co-sign, pemberian obat, observasi, dan intervensi askep tersimpan
 * di toko demo (`rekam-medis`, ADR-0085) lewat Server Action; data baru datang dari server setelah aksi. Yang lokal
 * hanya keadaan tampilan (tab, pindai gelang di layar ini) dan dosis pasien skenario sebelum tugas Simulasi-nya.
 */
export function InpatientWorkspace({
  detail,
  patient,
  user,
  userRole,
  canCosign,
  canNurse,
  canObserve,
  rev,
  storedGiven,
  storedLog,
  initialTab,
  scenario,
  summaryRows,
  links,
  sbar,
}: {
  detail: InpatientDetail;
  patient: { name: string; rm: string };
  user: string;
  userRole: string | null;
  canCosign: boolean;
  /** Posisi perawat/bidan: mencatat intervensi keperawatan. */
  canNurse: boolean;
  /** Posisi yang mencatat observasi tanda vital (perawat, bidan, dokter). */
  canObserve: boolean;
  /** Revisi toko `rekam-medis` yang dilihat layar ini. */
  rev: number;
  /** Pemberian tersimpan per slot `<obat>|<jam>` (pasien fixture). */
  storedGiven: Record<string, string>;
  storedLog: EmarLogLine[];
  initialTab: InpatientTab;
  scenario: ScenarioStepState | null;
  summaryRows: Array<{ label: string; value: string }>;
  links: Array<{ href: string; label: string }>;
  sbar: { s: string; b: string; a: string; r: string };
}) {
  const { runTask, pending, error } = useScenarioTask(scenario?.rev ?? 0);
  const tabsId = useId();
  const [tab, setTab] = useState<string>(initialTab);
  const [emar, setEmar] = useState<EmarLocal>({
    scan: { status: 'terkunci', at: null, reason: null },
    given: {},
    log: [],
  });
  const enc = detail.summary.encounterId;
  const scenarioPatient = detail.summary.scenario;
  // Hari rawat berjalan = tanggal observasi terakhir (pasien skenario mengikuti jam Simulasinya).
  const today = detail.observations.at(-1)?.at ?? `${detail.summary.admittedOn}T00:00:00+07:00`;

  // Pasien skenario: gelang dianggap terpindai begitu tugas `emar` selesai di Simulasi.
  const scan =
    scenario && taskDone(scenario, 'emar') && emar.scan.status === 'terkunci'
      ? { status: 'cocok' as const, at: null, reason: null }
      : emar.scan;
  const emarState: EmarLocal = {
    scan,
    given: { ...storedGiven, ...emar.given },
    log: [...storedLog, ...emar.log],
  };

  const items = [
    { id: 'ringkasan', label: 'Ringkasan', content: <SummaryPanel rows={summaryRows} links={links} /> },
    {
      id: 'cppt',
      label: 'CPPT & eMAR',
      content: (
        <div className="flex flex-wrap items-start gap-4">
          <CpptPanel
            encounterId={enc}
            entries={detail.cppt}
            user={user}
            userRole={userRole}
            today={today}
            canCosign={canCosign}
            rev={rev}
            sbar={sbar}
          />
          <EmarPanel
            encounterId={enc}
            meds={detail.medications}
            now={detail.emarNow}
            note={detail.emarNote}
            rm={patient.rm}
            name={patient.name}
            nurse={user}
            rev={rev}
            state={emarState}
            wait={scenario ? emarTurnBlocker(scenario.tasks.emar) : null}
            scenarioTask={taskEnabled(scenario ?? undefined, 'emar')}
            scenarioBusy={pending}
            onChange={setEmar}
            onAllDue={() => runTask(scenario ?? undefined, 'emar', true)}
            footer={<MonitoringTiles observations={detail.observations} gds={gdsTrend(detail.results)} />}
          />
        </div>
      ),
    },
    {
      id: 'obs',
      label: 'Observasi & EWS',
      content: (
        <EwsPanel
          observations={detail.observations}
          entry={
            scenarioPatient ? null : { encounterId: enc, rev, allowed: canObserve, user }
          }
        />
      ),
    },
    {
      id: 'askep',
      label: 'Asuhan keperawatan',
      content: (
        <NursingPanel
          encounterId={enc}
          rev={rev}
          problems={detail.nursing}
          shift={nursingShift(detail.emarNow)}
          lockedReason={
            scenarioPatient
              ? 'Pasien simulasi: asuhan keperawatannya mengikuti langkah skenario.'
              : canNurse
                ? null
                : 'Intervensi keperawatan dicatat posisi perawat atau bidan.'
          }
        />
      ),
    },
    { id: 'hasil', label: 'Hasil', content: <ResultsPanel results={detail.results} /> },
  ];

  const current = items.find((t) => t.id === tab) ?? items[1] ?? items[0];
  if (!current) return null;

  return (
    <div className="flex flex-col gap-4">
      {scenario && <DayJumps state={scenario} pending={pending} runTask={(s, t, v) => runTask(s, t, v)} />}
      {error && (
        <span role="alert" className="text-caption font-semibold text-danger">
          {error.message}
        </span>
      )}
      <div className="flex flex-col gap-3">
        {/* Pil tab (mockup Ranap) membungkus di layar sempit; panel diatur di sini. */}
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
    </div>
  );
}
