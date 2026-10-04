'use client';

import { type CpptEntry, formatJam, type InpatientDetail } from '@simrs/shared';
import { useState } from 'react';
import { PillTabs } from '@/components/rawat-inap/pill-tabs';
import { taskDone, taskEnabled, useScenarioTask } from '@/components/rawat-inap/use-scenario-task';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';
import { CpptPanel } from './cppt-panel';
import { DayJumps } from './day-jumps';
import { type EmarLocal, EmarPanel } from './emar-panel';
import { EwsPanel, NursingPanel, ResultsPanel, SummaryPanel } from './inpatient-panels';
import type { InpatientTab } from './tabs';

/** K04/K07/K12 · Lima tab rekam rawat inap; state lokal (CPPT baru, eMAR, centang askep) bertahan antar-tab. */
export function InpatientWorkspace({
  detail,
  patient,
  user,
  canCosign,
  initialTab,
  scenario,
  summaryRows,
  links,
  sbar,
}: {
  detail: InpatientDetail;
  patient: { name: string; rm: string };
  user: string;
  canCosign: boolean;
  initialTab: InpatientTab;
  scenario: ScenarioStepState | null;
  summaryRows: Array<{ label: string; value: string }>;
  links: Array<{ href: string; label: string }>;
  sbar: { s: string; b: string; a: string; r: string };
}) {
  const { runTask, pending, error } = useScenarioTask(scenario?.rev ?? 0);
  const [tab, setTab] = useState<string>(initialTab);
  const [added, setAdded] = useState<CpptEntry[]>([]);
  const [cosigned, setCosigned] = useState<Record<string, { by: string; at: string }>>({});
  const [emar, setEmar] = useState<EmarLocal>({
    scan: { status: 'terkunci', at: null, reason: null },
    given: {},
    log: [],
  });
  const [askep, setAskep] = useState<Record<string, boolean>>({});
  const enc = detail.summary.encounterId;

  const entries = [...detail.cppt, ...added].map((e) => {
    const c = cosigned[e.id];
    return c ? { ...e, cosignedBy: c.by, cosignedAt: c.at } : e;
  });
  // Pasien skenario: gelang dianggap terpindai begitu tugas `emar` selesai di Simulasi.
  const scan =
    scenario && taskDone(scenario, 'emar') && emar.scan.status === 'terkunci'
      ? { status: 'cocok' as const, at: null, reason: null }
      : emar.scan;
  const onScan = () => {
    const at = formatJam(new Date());
    const unlock = () => setEmar((cur) => ({ ...cur, scan: { status: 'cocok', at, reason: null } }));
    if (scenario && taskEnabled(scenario, 'emar')) runTask(scenario, 'emar', true, (ok) => ok && unlock());
    else unlock();
  };
  const nursing = detail.nursing.map((p) => ({
    diagnosis: p.diagnosis,
    interventions: p.interventions.map((i) => ({ ...i, done: askep[i.id] ?? i.done })),
  }));

  const items = [
    { id: 'ringkasan', label: 'Ringkasan', content: <SummaryPanel rows={summaryRows} links={links} /> },
    {
      id: 'cppt',
      label: 'CPPT & eMAR',
      content: (
        <div className="flex flex-wrap items-start gap-4">
          <CpptPanel
            encounterId={enc}
            entries={entries}
            canCosign={canCosign}
            sbar={sbar}
            onAdd={(e) => setAdded((cur) => [...cur, e])}
            onCosign={(id, by, at) => setCosigned((cur) => ({ ...cur, [id]: { by, at } }))}
          />
          <EmarPanel
            encounterId={enc}
            meds={detail.medications}
            now={detail.emarNow}
            note={detail.emarNote}
            rm={patient.rm}
            name={patient.name}
            nurse={user}
            state={{ ...emar, scan }}
            scenarioBusy={pending}
            onScan={onScan}
            onChange={setEmar}
          />
        </div>
      ),
    },
    { id: 'obs', label: 'Observasi & EWS', content: <EwsPanel observations={detail.observations} /> },
    {
      id: 'askep',
      label: 'Asuhan keperawatan',
      content: (
        <NursingPanel
          problems={nursing}
          onToggle={(id) =>
            setAskep((cur) => {
              const base =
                detail.nursing.flatMap((p) => p.interventions).find((i) => i.id === id)?.done ?? false;
              return { ...cur, [id]: !(cur[id] ?? base) };
            })
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
        <PillTabs
          label="Bagian rekam rawat inap"
          value={current.id}
          onChange={setTab}
          items={items.map(({ id, label }) => ({ id, label }))}
        />
        <div role="tabpanel" aria-label={current.label}>
          {current.content}
        </div>
      </div>
    </div>
  );
}
