'use client';

import { SafetyGate } from '@simrs/ui';
import { flowReason, type ScenarioFlow } from '@/lib/keuangan-flow';
import { ChoiceCards } from './choice-cards';
import { FlowTaskButton } from './flow-task-button';

/**
 * Validasi koding pasien skenario di layar Klaim: diagnosis utama (pilihan), gerbang ketidaksesuaian bukti
 * (troponin vs kode angina; override wajib alasan), lalu validasi sekunder/kode. Hanya tugas giliran yang aktif.
 */
export function ClaimScenarioControls({
  flow,
  pending,
  onTask,
  onReason,
}: {
  flow: ScenarioFlow;
  pending: boolean;
  onTask: (task: string, value: true | string) => void;
  onReason: (reason: string) => void;
}) {
  const utama = flow.tasks.utama;
  const bukti = flow.tasks.bukti;
  const run = (task: string) => onTask(task, true);
  return (
    <div className="flex flex-col gap-2.5 rounded-control border border-brand-200 bg-brand-50 p-3">
      <span className="text-caption font-semibold text-brand-700">Validasi koding · pasien simulasi</span>
      {utama && (
        <div className="flex flex-col gap-1.5">
          <ChoiceCards
            legend={utama.label}
            showLegend
            className="flex flex-col gap-1.5"
            value={utama.value}
            onChange={(id) => {
              if (utama.enabled && !pending) onTask('utama', id);
            }}
            options={utama.options.map((o) => ({
              ...o,
              disabled: !utama.enabled || pending,
            }))}
          />
          {!utama.done && flowReason(flow, 'utama') && (
            <span className="text-caption font-medium text-warning">{flowReason(flow, 'utama')}</span>
          )}
        </div>
      )}
      {bukti?.visible && (
        <SafetyGate
          tone="warning"
          title={bukti.label}
          recommendation="Kembali ke I21.4"
          overrideLabel="Kirim query ke DPJP (klaim ditahan)"
          disabled={!bukti.enabled || pending}
          onFollow={() => onTask('bukti', 'kembali')}
          onOverride={(reason) => {
            onReason(reason);
            onTask('bukti', 'query');
          }}
          resolved={
            bukti.done
              ? bukti.value === 'kembali'
                ? { kind: 'ikuti', text: `Kode dikoreksi ke I21.4 · ${bukti.at ?? ''}` }
                : { kind: 'override', text: `Query dijawab DPJP: I21.4 · ${bukti.at ?? ''}` }
              : null
          }
        >
          Sistem menandai ketidaksesuaian antara kode dan hasil lab: troponin I meningkat dan EKG iskemik
          mendukung infark, bukan angina. Grouping ditahan sampai ditindaklanjuti.
        </SafetyGate>
      )}
      <FlowTaskButton
        flow={flow}
        task="sekunder"
        label="Validasi diagnosis sekunder dan prosedur"
        doneText="Diagnosis sekunder dan prosedur divalidasi"
        pending={pending}
        onRun={run}
      />
      <FlowTaskButton
        flow={flow}
        task="kode"
        label="Validasi kode K80.2 dan 51.23"
        doneText="Kode sesuai bukti"
        pending={pending}
        onRun={run}
      />
    </div>
  );
}
