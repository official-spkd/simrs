'use client';

import { cx, SafetyGate } from '@simrs/ui';
import { flowReason, type ScenarioFlow } from '@/lib/keuangan-flow';
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
    <div className="flex flex-col gap-2.5 rounded-control border border-[#9FCFC8] bg-[#F7FBFA] p-3">
      <span className="text-caption font-semibold text-brand-700">Validasi koding · pasien simulasi</span>
      {utama && (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 text-small font-semibold">{utama.label}</legend>
          <div role="radiogroup" aria-label={utama.label} className="flex flex-col gap-1.5">
            {utama.options.map((o) => {
              const on = utama.value === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!utama.enabled || pending}
                  onClick={() => onTask('utama', o.id)}
                  className={cx(
                    'flex min-h-11 flex-col rounded-control border-[1.5px] px-3 py-1.5 text-left font-[inherit] text-ink-900 disabled:cursor-not-allowed',
                    on ? 'border-brand-600 bg-[#F2FAF8]' : 'border-line bg-white',
                    utama.enabled && !pending && 'cursor-pointer',
                  )}
                >
                  <span className="font-semibold">{o.label}</span>
                  <span className="text-caption text-ink-500">{o.sub}</span>
                </button>
              );
            })}
          </div>
          {!utama.done && flowReason(flow, 'utama') && (
            <span className="text-caption font-medium text-warning">{flowReason(flow, 'utama')}</span>
          )}
        </fieldset>
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
